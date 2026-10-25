// Projeção do resultado final, cidade por cidade (sempre rotulada "estimativa", sempre com faixa).
//
// Total final = o que já foi contado (exato, arquivo do TSE) + o que falta em cada cidade, onde
//   falta_i = eleitores ainda não apurados × comparecimento × fração de votos em A ou B
// e a % de A nesse resto vem de um modelo em logit:
//   logit(% de A) = logit(% de A no A×B da eleição-base) + covariáveis·β + região + UF + vizinhança + cidade
// β e os efeitos são reestimados a cada ciclo com as cidades que já têm votos (mínimos quadrados ponderados,
// efeitos encolhidos para zero quando há pouco dado). A cidade parcialmente apurada pesa o próprio parcial,
// descontando que as primeiras seções de uma cidade não são uma amostra aleatória dela.
//
// A incerteza soma as fontes de erro do resto: β, região, UF, cidade (com vizinhança e parcial), deriva dentro
// da cidade, um erro sistemático do resto inteiro e o comparecimento. O tamanho final da faixa é calibrado
// no backtest das noites reais (packages/data/scripts/backtest-projection.ts) e, durante a noite, se alarga
// sozinho quando as cidades que vão chegando erram mais do que o previsto (autoavaliação, `ProjLearn`).
import type { HistRow } from './types';
import { UF_REGION } from './ufs';

// ------------------------------------------------------------------ parâmetros

export interface ProjParams {
  /** dp do efeito próprio da cidade (logit), antes de ver dado */
  sigmaCity: number;
  /** dp dos efeitos de região e de UF (logit) — piso: a estimativa da noite só pode aumentar */
  tauReg: number;
  tauUf: number;
  /** fração da variância da cidade que é compartilhada com as vizinhas (antes de ver dado) */
  spatialRho: number;
  /** quantos vizinhos (mesma UF) olhar */
  neighbors: number;
  /** dp do desvio das primeiras seções de uma cidade em relação ao total dela, com ~0% apurado (logit) */
  sigmaDrift: number;
  /** erro sistemático do resto inteiro (logit): o que ninguém viu ainda pode ser diferente do que já veio */
  sigmaSys: number;
  /** precisão do prior das covariáveis (padronizadas) e do intercepto */
  ridge: number;
  ridge0: number;
  /** eleitores para confiar no comparecimento / % de válidos observados na própria cidade */
  kTurnout: number;
  kValid: number;
  /** encolhimento das razões de comparecimento por UF (em eleitores) */
  kRatioUf: number;
  /** dp (log) do comparecimento do resto, por UF e no Brasil */
  turnoutSdUf: number;
  turnoutSdBr: number;
  /** cidades com menos votos que isso não entram no ajuste */
  minVotes: number;
  /** expoente do peso extra das cidades grandes no ajuste: (eleitorado ÷ mediana)^α */
  voteWeight: number;
  /** fator de calibração da faixa por % apurado: pares [pst, fator], interpolados */
  calib: [number, number][];
  /** z da faixa (1,96 = 95%) */
  z: number;
}

export const PROJ_PARAMS: ProjParams = {
  sigmaCity: 0.12,
  tauReg: 0.05,
  tauUf: 0.05,
  spatialRho: 0.4,
  neighbors: 8,
  sigmaDrift: 0.15,
  sigmaSys: 0.03,
  ridge: 400,
  ridge0: 1,
  kTurnout: 3000,
  kValid: 3000,
  kRatioUf: 50_000,
  turnoutSdUf: 0.02,
  turnoutSdBr: 0.01,
  minVotes: 20,
  voteWeight: 0,
  calib: [[0, 1]],
  z: 1.96,
};

export const PROJ_FEATURES = [
  'outros no 1º turno',
  'outros × lado',
  'brancos e nulos',
  'porte',
  '2º turno anterior',
  'transferência anterior',
  'capital',
] as const;

// ------------------------------------------------------------------ utilidades

const P_MIN = 0.002;
export const logit = (p: number) => {
  const q = Math.min(1 - P_MIN, Math.max(P_MIN, p));
  return Math.log(q / (1 - q));
};
export const expit = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const sq = (x: number) => x * x;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Φ(x), normal padrão (Abramowitz–Stegun 7.1.26, erro < 1,5e-7) */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-sq(x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** inversa de uma matriz simétrica positiva pequena (Gauss–Jordan) */
function invert(m: number[][]): number[][] {
  const n = m.length;
  const a = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c] || 1e-12;
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c || !a[r][c]) continue;
      const f = a[r][c];
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((r) => r.slice(n));
}

/** interpola [x, y] (x crescente), constante fora */
function interp(pts: [number, number][], x: number): number {
  if (!pts.length) return 1;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (x <= x1) {
      const [x0, y0] = pts[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
    }
  }
  return pts[pts.length - 1][1];
}

// ------------------------------------------------------------------ modelo estático (montado uma vez)

export interface ProjAreaInput {
  /** IBGE (exterior: zz<tse>) */
  id: string;
  uf: string;
  el: number;
  /** eleição-base: o 1º turno desta eleição */
  base: HistRow | null;
  /** 2º turno da eleição anterior (mesmo tipo de disputa) e o 1º turno dela */
  prev?: HistRow | null;
  prevT1?: HistRow | null;
  lat?: number;
  lon?: number;
  capital?: boolean;
}

/** números de A e B nesta eleição e, se houver, na anterior */
export interface ProjSides {
  a: string;
  b: string;
  /** números de A e B na eleição-base, se diferentes (backtest de uma noite de 1º turno sobre o 2º turno anterior) */
  baseA?: string;
  baseB?: string;
  prevA?: string;
  prevB?: string;
}

/** centro aproximado (média dos vértices) de cada feição de um GeoJSON com `properties.ibge` */
export function centroidsOf(fc: { features: { properties: { ibge?: string }; geometry: { type: string; coordinates: unknown } }[] }) {
  const out: Record<string, { lat: number; lon: number }> = {};
  for (const f of fc.features) {
    const id = f.properties?.ibge;
    if (!id || !f.geometry) continue;
    let sx = 0;
    let sy = 0;
    let c = 0;
    const walk = (x: unknown) => {
      if (!Array.isArray(x)) return;
      if (typeof x[0] === 'number') {
        sx += x[0] as number;
        sy += x[1] as number;
        c++;
      } else for (const y of x) walk(y);
    };
    walk(f.geometry.coordinates);
    if (c) out[id] = { lat: sy / c, lon: sx / c };
  }
  return out;
}

export interface ProjArea {
  id: string;
  uf: string;
  reg: string;
  el: number;
  /** logit da % de A no A×B da eleição-base */
  x1: number;
  /** [1, covariáveis padronizadas] */
  f: number[];
  /** comparecimento / eleitorado na base */
  tr: number;
  /** válidos / comparecimento na base (prior da fração A+B do comparecimento) */
  vr: number;
  /** índices dos vizinhos mais próximos na mesma UF */
  nb: number[];
}

export interface ProjModel {
  areas: ProjArea[];
  index: Map<string, number>;
  /** dimensão de f (com o intercepto) */
  k: number;
  ufs: string[];
  regs: string[];
  /** média e dp de cada covariável (para o diagnóstico) */
  scale: { mean: number[]; sd: number[] };
  /** eleitorado mediano das áreas */
  medEl: number;
}

function twoWayLogit(h: HistRow, a: string, b: string): number | null {
  const va = h.votes[a] ?? 0;
  const vb = h.votes[b] ?? 0;
  return va + vb > 0 ? logit((va + 0.5) / (va + vb + 1)) : null;
}

export function buildProjModel(list: ProjAreaInput[], sides: ProjSides, ufBase: Record<string, HistRow> = {}, p: ProjParams = PROJ_PARAMS): ProjModel {
  const rows: { x: ProjAreaInput; x1: number; raw: (number | null)[]; tr: number; vr: number }[] = [];
  const A = sides.baseA ?? sides.a;
  const B = sides.baseB ?? sides.b;
  for (const x of list) {
    const b = x.base && twoWayLogit(x.base, A, B) !== null && x.base.turnout > 0 ? x.base : ufBase[x.uf];
    if (!b || !b.turnout) continue;
    const x1 = twoWayLogit(b, A, B);
    if (x1 === null) continue;
    const va = b.votes[A] ?? 0;
    const vb = b.votes[B] ?? 0;
    const o = b.valid > 0 ? clamp(1 - (va + vb) / b.valid, 0, 1) : 0;
    let g: number | null = null;
    let d: number | null = null;
    if (x.prev && sides.prevA && sides.prevB) {
      const lp = twoWayLogit(x.prev, sides.prevA, sides.prevB);
      if (lp !== null) {
        g = lp - x1;
        const lq = x.prevT1 ? twoWayLogit(x.prevT1, sides.prevA, sides.prevB) : null;
        if (lq !== null) d = lp - lq;
      }
    }
    rows.push({
      x,
      x1,
      raw: [o, o * (expit(x1) - 0.5), (b.blank + b.nulls) / b.turnout, Math.log10(Math.max(100, x.el)), g, d, x.capital ? 1 : 0],
      tr: b.el > 0 ? clamp(b.turnout / b.el, 0.2, 1) : 0.79,
      vr: clamp(b.valid / b.turnout, 0.5, 1),
    });
  }
  // padroniza as covariáveis (média 0, dp 1); faltando = média
  const nf = PROJ_FEATURES.length;
  const mean: number[] = [];
  const sd: number[] = [];
  for (let j = 0; j < nf; j++) {
    const v = rows.map((r) => r.raw[j]).filter((x): x is number => x !== null && Number.isFinite(x));
    const m = v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
    const s = v.length ? Math.sqrt(v.reduce((s2, x) => s2 + sq(x - m), 0) / v.length) : 0;
    mean.push(m);
    sd.push(s);
  }
  const areas: ProjArea[] = rows.map((r) => ({
    id: r.x.id,
    uf: r.x.uf,
    reg: UF_REGION[r.x.uf] ?? 'ZZ',
    el: r.x.el,
    x1: r.x1,
    f: [1, ...r.raw.map((v, j) => (v === null || !Number.isFinite(v) || sd[j] < 1e-9 ? 0 : (v - mean[j]) / sd[j]))],
    tr: r.tr,
    vr: r.vr,
    nb: [],
  }));
  // vizinhos: os mais próximos na mesma UF (distância equirretangular)
  const byUf = new Map<string, number[]>();
  areas.forEach((a, i) => {
    if (rows[i].x.lat !== undefined && rows[i].x.lon !== undefined) (byUf.get(a.uf) ?? byUf.set(a.uf, []).get(a.uf)!).push(i);
  });
  for (const idx of byUf.values()) {
    for (const i of idx) {
      const { lat, lon } = rows[i].x as Required<ProjAreaInput>;
      const c = Math.cos((lat * Math.PI) / 180);
      areas[i].nb = idx
        .filter((j) => j !== i)
        .map((j) => [j, sq((rows[j].x.lat! - lat)) + sq((rows[j].x.lon! - lon) * c)] as const)
        .sort((x, y) => x[1] - y[1])
        .slice(0, p.neighbors)
        .map(([j]) => j);
    }
  }
  return {
    areas,
    index: new Map(areas.map((a, i) => [a.id, i])),
    k: nf + 1,
    ufs: [...new Set(areas.map((a) => a.uf))],
    regs: [...new Set(areas.map((a) => a.reg))],
    scale: { mean, sd },
    medEl: [...areas.map((a) => a.el)].sort((x, y) => x - y)[Math.floor(areas.length / 2)] ?? 1,
  };
}

// ------------------------------------------------------------------ aprendizado durante a noite

/**
 * Estado aprendido na noite (serializável, vive no estado do poller):
 *  - deriva dentro da cidade: o primeiro parcial de cada cidade vs o total quando ela fecha;
 *  - autoavaliação: o que o modelo previa para uma cidade antes de ela ter voto vs o que veio.
 */
export interface ProjLearn {
  /** id → [fração apurada, logit de A, votos A+B] do primeiro parcial (fração −1 = já usado) */
  first: Record<string, [number, number, number]>;
  /** pares parcial→final: [fração, logit parcial, logit final, votos do parcial] */
  drift: [number, number, number, number][];
  /** id → [logit previsto, variância da previsão, peso em votos]: atualizado enquanto a cidade não tem voto,
   *  congelado quando ela aparece e conferido quando ela passa de 60% apurado */
  pred: Record<string, [number, number, number]>;
  /** ids cuja previsão já está congelada (a cidade apareceu) */
  frozen?: Record<string, 1>;
  /** último retrato usado de cada cidade parcial: [fração, logit, votos] */
  last?: Record<string, [number, number, number]>;
  /** passos do parcial de uma cidade entre dois retratos: [Δfração, logit antes − logit depois, variância do ruído] */
  steps?: [number, number, number][];
  /** erros das previsões quando a cidade apareceu: [erro, variância esperada, peso] (mais recentes no fim) */
  errs: [number, number, number][];
}

export const emptyLearn = (): ProjLearn => ({ first: {}, drift: [], pred: {}, errs: [] });

const MAX_LEARN = 4000;

// ------------------------------------------------------------------ entrada e saída de cada ciclo

export interface ProjObs {
  /** andamento atual (arquivo -ab): eleitorado total (se vier; senão o do modelo), apurado e comparecimento nele */
  el?: number;
  elc: number;
  turnout: number;
  /** último retrato com votos (pode ser de um ciclo anterior ao andamento) */
  snap?: { a: number; b: number; turnout: number; elc: number } | null;
}

export interface ProjTotals {
  a: number;
  b: number;
  el: number;
  elc: number;
}

export interface ProjInput {
  /** totais exatos já contados (arquivo BR) */
  br: ProjTotals;
  /** totais exatos por UF (arquivo de cada UF), chave = sigla */
  ufs?: Record<string, ProjTotals>;
  /** observação de cada área, na ordem de `model.areas` */
  obs: (ProjObs | null | undefined)[];
  /** % de seções apuradas no Brasil (para a calibração) */
  pst: number;
  learn?: ProjLearn;
}

export interface ProjEstimate {
  /** % final de A (0–100) e faixa */
  pa: number;
  lo: number;
  hi: number;
  /** dp (pontos) já calibrado */
  sd: number;
  /** probabilidade de A terminar à frente */
  pWin: number;
}

export interface ProjDiag {
  /** cidades com voto no ajuste e cidades com resto previsto */
  nFit: number;
  nRem: number;
  /** % dos votos A+B finais que ainda são previsão */
  remShare: number;
  sigmaCity: number;
  tauUf: number;
  tauReg: number;
  rho: number;
  sigmaDrift: number;
  /** deriva média das primeiras seções (logit, com 0% apurado na cidade) */
  driftMean: number;
  /** pares de deriva e erros de autoavaliação usados */
  nDrift: number;
  nErr: number;
  /** viés recente das previsões (logit) e z RMS das cidades que chegaram */
  bias: number;
  zRms: number;
  sigmaSys: number;
  calib: number;
  beta: Record<string, number>;
  reg: Record<string, number>;
  /** comparecimento e fração A+B do 2º turno em relação à base */
  turnoutRatio: number;
  validRatio: number;
  /** maior ajuste aplicado ao "resto" de uma UF para bater com o arquivo da UF */
  remScaleMax: number;
  /** participação de cada fonte na variância do Brasil */
  var: Record<string, number>;
}

export interface ProjResult extends ProjEstimate {
  ufs: Record<string, ProjEstimate & { pst: number }>;
  diag: ProjDiag;
  /** áreas ainda sem voto: índice → [logit previsto, variância, peso] (para a autoavaliação) */
  pending: Map<number, [number, number, number]>;
}

// ------------------------------------------------------------------ o ciclo

interface Ev {
  i: number;
  /** logit observado − base */
  y: number;
  /** variância de ruído amostral e de deriva (sem o efeito da cidade) */
  e: number;
  f: number;
  n: number;
}

/**
 * Deriva dentro da cidade, aprendida com cidades que já fecharam (misturada ao prior): as primeiras seções de
 * uma cidade puxam, em média, `mean`·(1−f) para algum lado (logit) e se espalham com variância `v`·(1−f).
 */
function driftOf(learn: ProjLearn | undefined, p: ProjParams): { mean: number; v: number; n: number } {
  const prior = sq(p.sigmaDrift);
  const pairs = learn?.drift ?? [];
  const steps = learn?.steps ?? [];
  if (!pairs.length && !steps.length) return { mean: 0, v: prior, n: 0 };
  // média: regressão pela origem de (antes − depois) em (Δ fração), com pares parcial→final e passos entre retratos
  let num = 0;
  let den = 1 / sq(0.1);
  for (const [f, yp, yf, n] of pairs) {
    const q = expit(yp);
    const v = prior * (1 - f) + 1 / Math.max(1, n * q * (1 - q));
    num += ((yp - yf) * (1 - f)) / v;
    den += sq(1 - f) / v;
  }
  for (const [df, dy, nv] of steps) {
    const v = prior * df + nv;
    num += (dy * df) / v;
    den += (df * df) / v;
  }
  const mean = clamp(num / den, -0.3, 0.3);
  // dispersão: só com cidades que já fecharam
  const k0 = 30;
  let ss = 0;
  let sf = 0;
  for (const [f, yp, yf, n] of pairs) {
    const q = expit(yp);
    ss += sq(yp - yf - mean * (1 - f)) - 1 / Math.max(1, n * q * (1 - q));
    sf += 1 - f;
  }
  return { mean, v: Math.max(0.25 * prior, (ss + k0 * prior) / (sf + k0)), n: pairs.length + steps.length };
}

/** viés e z RMS das previsões recentes (cidades que acabaram de aparecer) */
function selfCheck(learn: ProjLearn | undefined): { bias: number; biasVar: number; zRms: number; n: number } {
  const errs = learn?.errs.slice(-600) ?? [];
  if (errs.length < 30) return { bias: 0, biasVar: 0, zRms: 1, n: errs.length };
  let sw = 0;
  let swr = 0;
  let sw2v = 0;
  let z2 = 0;
  for (const [r, v, w] of errs) {
    sw += w;
    swr += w * r;
    sw2v += w * w * v;
    z2 += (r * r) / v;
  }
  return { bias: swr / sw, biasVar: sw2v / (sw * sw), zRms: Math.sqrt(z2 / errs.length), n: errs.length };
}

export function projectByCity(model: ProjModel, input: ProjInput, p: ProjParams = PROJ_PARAMS): ProjResult | null {
  const { areas, k } = model;
  const n = areas.length;
  const totBr = input.br;
  if (!n || totBr.a + totBr.b <= 0) return null;
  const drift = driftOf(input.learn, p);
  const sw2 = drift.v;

  // --- evidência: cidades com votos
  const ev: Ev[] = [];
  for (let i = 0; i < n; i++) {
    const s = input.obs[i]?.snap;
    if (!s) continue;
    const m = s.a + s.b;
    if (m < p.minVotes) continue;
    const q = (s.a + 0.5) / (m + 1);
    const f = clamp(s.elc / Math.max(1, input.obs[i]?.el || areas[i].el), 0, 1);
    // desconta a deriva média das primeiras seções (aprendida na noite)
    ev.push({ i, y: logit(q) - drift.mean * (1 - f) - areas[i].x1, e: 1 / (m * q * (1 - q)) + sw2 * (1 - f), f, n: m });
  }
  const evOf = new Map(ev.map((e, j) => [e.i, j]));

  // --- ajuste: β, região, UF (backfitting), com σ da cidade e τ da UF reestimados
  let sc2 = sq(p.sigmaCity);
  let tUf2 = sq(p.tauUf);
  let tReg2 = sq(p.tauReg);
  let beta = new Array<number>(k).fill(0);
  let cov: number[][] = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 1 / (i ? p.ridge : p.ridge0) : 0)));
  const uReg: Record<string, number> = {};
  const uUf: Record<string, number> = {};
  const vReg: Record<string, number> = {};
  const vUf: Record<string, number> = {};
  const w = new Float64Array(ev.length);
  const mult = ev.map((e) => (p.voteWeight ? clamp((areas[e.i].el / model.medEl) ** p.voteWeight, 0.1, 50) : 1));
  const resid = new Float64Array(ev.length);
  /** covariáveis·β de cada cidade com voto (refeito a cada novo β) */
  const fb = new Float64Array(ev.length);
  for (let outer = 0; outer < 2 && ev.length; outer++) {
    for (let j = 0; j < ev.length; j++) w[j] = mult[j] / (sc2 + ev[j].e);
    for (let it = 0; it < 4; it++) {
      // β
      const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? (i ? p.ridge : p.ridge0) : 0)));
      const bv = new Array<number>(k).fill(0);
      for (let j = 0; j < ev.length; j++) {
        const a = areas[ev[j].i];
        const r = ev[j].y - (uReg[a.reg] ?? 0) - (uUf[a.uf] ?? 0);
        const f = a.f;
        for (let x = 0; x < k; x++) {
          bv[x] += w[j] * f[x] * r;
          for (let y = x; y < k; y++) A[x][y] += w[j] * f[x] * f[y];
        }
      }
      for (let x = 0; x < k; x++) for (let y = 0; y < x; y++) A[x][y] = A[y][x];
      cov = invert(A);
      beta = cov.map((row) => row.reduce((s, c, y) => s + c * bv[y], 0));
      for (let j = 0; j < ev.length; j++) {
        const f = areas[ev[j].i].f;
        let x = 0;
        for (let c = 0; c < k; c++) x += f[c] * beta[c];
        fb[j] = x;
      }
      // região, depois UF (encolhidos)
      for (const [key, tau2, u, vOut, other] of [
        ['reg', tReg2, uReg, vReg, uUf],
        ['uf', tUf2, uUf, vUf, uReg],
      ] as const) {
        const sw: Record<string, number> = {};
        const swr: Record<string, number> = {};
        for (let j = 0; j < ev.length; j++) {
          const a = areas[ev[j].i];
          const g = key === 'reg' ? a.reg : a.uf;
          const og = key === 'reg' ? a.uf : a.reg;
          sw[g] = (sw[g] ?? 0) + w[j];
          swr[g] = (swr[g] ?? 0) + w[j] * (ev[j].y - fb[j] - (other[og] ?? 0));
        }
        for (const g of Object.keys(u)) delete u[g];
        for (const g of Object.keys(sw)) {
          u[g] = swr[g] / (sw[g] + 1 / tau2);
          vOut[g] = 1 / (sw[g] + 1 / tau2);
        }
      }
    }
    // resíduos e reestimação de σ²(cidade) e τ²(UF), τ²(região)
    let num = 0;
    let cnt = 0;
    for (let j = 0; j < ev.length; j++) {
      const a = areas[ev[j].i];
      resid[j] = ev[j].y - fb[j] - (uReg[a.reg] ?? 0) - (uUf[a.uf] ?? 0);
      if (ev[j].n >= 200) {
        num += sq(resid[j]) - ev[j].e;
        cnt++;
      }
    }
    const k0 = 100;
    sc2 = Math.max(0.3 * sq(p.sigmaCity), (num + k0 * sq(p.sigmaCity)) / (cnt + k0));
    tUf2 = Math.max(sq(p.tauUf), groupTau2(ev, w, resid, uUf, areas, 'uf'));
    tReg2 = Math.max(sq(p.tauReg), groupTau2(ev, w, resid, uReg, areas, 'reg'));
  }

  // --- vizinhança: correlação entre o resíduo de uma cidade e o das vizinhas (estimada na noite)
  let rhoNum = 0;
  let rhoDen = 0;
  let rhoN = 0;
  for (let j = 0; j < ev.length; j++) {
    let s = 0;
    let c = 0;
    for (const nb of areas[ev[j].i].nb) {
      const jj = evOf.get(nb);
      if (jj !== undefined) {
        s += resid[jj];
        c++;
      }
    }
    if (c >= 3 && ev[j].n >= 200) {
      rhoNum += resid[j] * (s / c);
      rhoDen += sq(resid[j]) - ev[j].e;
      rhoN++;
    }
  }
  const rhoHat = rhoDen > 0 ? clamp(rhoNum / rhoDen, 0, 0.9) : p.spatialRho;
  const rho = (rhoN * rhoHat + 200 * p.spatialRho) / (rhoN + 200);
  const ts2 = rho * sc2;

  // --- razões de comparecimento e de A+B por UF (2º turno ÷ base), com encolhimento ao Brasil
  const tNum: Record<string, number> = {};
  const tDen: Record<string, number> = {};
  const vNum: Record<string, number> = {};
  const vDen: Record<string, number> = {};
  let tN = 0;
  let tD = 0;
  let vN = 0;
  let vD = 0;
  for (let i = 0; i < n; i++) {
    const o = input.obs[i];
    const a = areas[i];
    if (o && o.elc > 0 && o.turnout > 0) {
      tNum[a.uf] = (tNum[a.uf] ?? 0) + o.turnout;
      tDen[a.uf] = (tDen[a.uf] ?? 0) + o.elc * a.tr;
      tN += o.turnout;
      tD += o.elc * a.tr;
    }
    const s = o?.snap;
    if (s && s.turnout > 0) {
      vNum[a.uf] = (vNum[a.uf] ?? 0) + s.a + s.b;
      vDen[a.uf] = (vDen[a.uf] ?? 0) + s.turnout * a.vr;
      vN += s.a + s.b;
      vD += s.turnout * a.vr;
    }
  }
  const tBr = tD > 0 ? tN / tD : 1;
  const vBr = vD > 0 ? vN / vD : 1;
  const K = p.kRatioUf;
  const tUf = (uf: string) => ((tNum[uf] ?? 0) + K * tBr) / ((tDen[uf] ?? 0) + K);
  const vUfR = (uf: string) => ((vNum[uf] ?? 0) + K * vBr) / ((vDen[uf] ?? 0) + K);

  // --- resto de cada área (eleitores), ajustado para bater com o arquivo da UF
  const rem = new Float64Array(n);
  const remUf: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    rem[i] = Math.max(0, (input.obs[i]?.el || areas[i].el) - (input.obs[i]?.elc ?? 0));
    remUf[areas[i].uf] = (remUf[areas[i].uf] ?? 0) + rem[i];
  }
  let remScaleMax = 1;
  const scaleUf: Record<string, number> = {};
  // a salvaguarda só olha UFs com resto relevante: perto do fim, segundos de diferença entre o arquivo da UF e o
  // andamento dão razões enormes sobre quase nada
  const remBr = Math.max(0, totBr.el - totBr.elc);
  for (const uf of model.ufs) {
    const t = input.ufs?.[uf];
    if (!t || !remUf[uf]) continue;
    const tr = Math.max(0, t.el - t.elc);
    const s = tr / remUf[uf];
    scaleUf[uf] = s;
    if (tr < Math.max(50_000, 0.01 * remBr) && remUf[uf] < Math.max(50_000, 0.01 * remBr)) continue;
    if (Math.abs(Math.log(s || 1e-9)) > Math.abs(Math.log(remScaleMax))) remScaleMax = s;
  }

  // --- previsão de cada área com resto
  const self = selfCheck(input.learn);
  const cityScale = clamp(sq(self.zRms), 1, 4);
  const sys2 = sq(p.sigmaSys) + Math.max(0, sq(self.bias) - self.biasVar);
  const V = new Float64Array(n);
  const P = new Float64Array(n);
  const G = new Float64Array(n);
  const L = new Float64Array(n);
  const VM = new Float64Array(n);
  const pending = new Map<number, [number, number, number]>();
  let nRem = 0;
  for (let i = 0; i < n; i++) {
    const a = areas[i];
    const r = rem[i] * (scaleUf[a.uf] ?? 1);
    if (r <= 0) continue;
    const o = input.obs[i];
    // comparecimento e fração A+B esperados no resto
    let tr = a.tr * tUf(a.uf);
    if (o && o.elc > 0 && o.turnout > 0) {
      const wt = o.elc / (o.elc + p.kTurnout);
      tr = wt * (o.turnout / o.elc) + (1 - wt) * tr;
    }
    let vr = a.vr * vUfR(a.uf);
    const s = o?.snap;
    if (s && s.turnout > 0) {
      const wv = s.turnout / (s.turnout + p.kValid);
      vr = wv * ((s.a + s.b) / s.turnout) + (1 - wv) * vr;
    }
    V[i] = r * clamp(tr, 0.2, 1) * clamp(vr, 0.3, 1);
    // % de A: estrutura + vizinhança
    let m = a.x1 + a.f.reduce((acc, c, x) => acc + c * beta[x], 0) + (uReg[a.reg] ?? 0) + (uUf[a.uf] ?? 0);
    let sw = 0;
    let swr = 0;
    for (const nb of a.nb) {
      const jj = evOf.get(nb);
      if (jj === undefined) continue;
      const wj = 1 / (sc2 + ev[jj].e);
      sw += wj;
      swr += wj * resid[jj];
    }
    const vs = ts2 > 0 ? 1 / (sw + 1 / ts2) : 0;
    m += ts2 > 0 ? swr * vs : 0;
    const vm = (sc2 - ts2 + vs) * cityScale;
    // parcial da própria cidade
    let mu = m;
    let vmu = vm;
    let lam = 0;
    const j = evOf.get(i);
    if (j !== undefined) {
      const e = ev[j];
      const f = Math.min(e.f, 0.95);
      const yObs = e.y + a.x1;
      const cv = vm - f * sw2;
      const vy = vm + e.e;
      lam = clamp(cv / vy, 0, 1);
      // o resto da cidade puxa para o lado oposto ao das primeiras seções
      mu = m + lam * (yObs - m) - drift.mean * f;
      const vt = vm + (sw2 * f * f) / (1 - f);
      vmu = Math.max(1e-6, vt - 2 * lam * cv + lam * lam * vy);
    } else {
      pending.set(i, [m, vm, 0]);
    }
    const pm = expit(mu / Math.sqrt(1 + (Math.PI * vmu) / 8));
    P[i] = pm;
    G[i] = V[i] * pm * (1 - pm);
    L[i] = lam;
    VM[i] = vmu;
    if (pending.has(i)) pending.get(i)![2] = G[i];
    nRem++;
  }

  // --- agregação e variância (Brasil e cada UF)
  const estimate = (inside: (a: ProjArea) => boolean, t: { a: number; b: number }, pst: number) => {
    let addA = 0;
    let addV = 0;
    for (let i = 0; i < n; i++) {
      if (!V[i] || !inside(areas[i])) continue;
      addA += V[i] * P[i];
      addV += V[i];
    }
    const T = t.a + t.b + addV;
    if (T <= 0) return null;
    const pa = (t.a + addA) / T;
    const gb = new Array<number>(k).fill(0);
    const gReg: Record<string, number> = {};
    const gUf: Record<string, number> = {};
    const hUf: Record<string, number> = {};
    let gSys = 0;
    let vCity = 0;
    let hAll = 0;
    for (let i = 0; i < n; i++) {
      if (!V[i] || !inside(areas[i])) continue;
      const a = areas[i];
      const gs = G[i] * (1 - L[i]);
      for (let x = 0; x < k; x++) gb[x] += gs * a.f[x];
      gReg[a.reg] = (gReg[a.reg] ?? 0) + gs;
      gUf[a.uf] = (gUf[a.uf] ?? 0) + gs;
      gSys += gs;
      vCity += sq(G[i]) * VM[i];
      const h = V[i] * (P[i] - pa);
      hUf[a.uf] = (hUf[a.uf] ?? 0) + h;
      hAll += h;
    }
    let vBeta = 0;
    for (let x = 0; x < k; x++) for (let y = 0; y < k; y++) vBeta += gb[x] * cov[x][y] * gb[y];
    const vR = Object.entries(gReg).reduce((s, [g, x]) => s + x * x * (vReg[g] ?? tReg2), 0);
    const vU = Object.entries(gUf).reduce((s, [g, x]) => s + x * x * (vUf[g] ?? tUf2), 0);
    const vS = gSys * gSys * sys2;
    const vT = Object.values(hUf).reduce((s, x) => s + x * x * sq(p.turnoutSdUf), 0) + sq(hAll * p.turnoutSdBr);
    const parts = { beta: vBeta, regiao: vR, uf: vU, cidade: vCity, sistematico: vS, comparecimento: vT };
    const total = vBeta + vR + vU + vCity + vS + vT;
    const c = Math.max(1, interp(p.calib, pst));
    const sd = (Math.sqrt(total) / T) * 100 * c;
    const pa100 = pa * 100;
    return {
      est: {
        pa: round2(pa100),
        lo: round2(pa100 - p.z * sd),
        hi: round2(pa100 + p.z * sd),
        sd: Math.round(sd * 1e4) / 1e4,
        pWin: sd > 0 ? Math.round(normCdf((pa100 - 50) / sd) * 1e4) / 1e4 : pa100 > 50 ? 1 : pa100 < 50 ? 0 : 0.5,
      },
      parts,
      total,
      remShare: addV / T,
      calib: c,
    };
  };

  const br = estimate(() => true, totBr, input.pst);
  if (!br) return null;
  const ufs: ProjResult['ufs'] = {};
  for (const uf of model.ufs) {
    const t = input.ufs?.[uf];
    if (!t) continue;
    const pst = t.el > 0 ? (t.elc / t.el) * 100 : 0;
    const e = estimate((a) => a.uf === uf, t, pst);
    if (e) ufs[uf] = { ...e.est, pst: round2(pst) };
  }
  const names = ['intercepto', ...PROJ_FEATURES];
  return {
    ...br.est,
    ufs,
    pending,
    diag: {
      nFit: ev.length,
      nRem,
      remShare: round2(br.remShare * 100),
      sigmaCity: round4(Math.sqrt(sc2)),
      tauUf: round4(Math.sqrt(tUf2)),
      tauReg: round4(Math.sqrt(tReg2)),
      rho: round4(rho),
      sigmaDrift: round4(Math.sqrt(sw2)),
      driftMean: round4(drift.mean),
      nDrift: drift.n,
      nErr: self.n,
      bias: round4(self.bias),
      zRms: round4(self.zRms),
      sigmaSys: round4(Math.sqrt(sys2)),
      calib: round4(br.calib),
      beta: Object.fromEntries(names.map((nm, x) => [nm, round4(beta[x])])),
      reg: Object.fromEntries(Object.entries(uReg).map(([g, v]) => [g, round4(v)])),
      turnoutRatio: round4(tBr),
      validRatio: round4(vBr),
      remScaleMax: round4(remScaleMax),
      var: Object.fromEntries(Object.entries(br.parts).map(([key, v]) => [key, br.total > 0 ? round4(v / br.total) : 0])),
    },
  };
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** τ² de um nível de grupo pelo método dos momentos (resíduo médio cru de cada grupo vs. o ruído dele) */
function groupTau2(ev: Ev[], w: Float64Array, resid: Float64Array, u: Record<string, number>, areas: ProjArea[], key: 'uf' | 'reg'): number {
  const sw: Record<string, number> = {};
  const swr: Record<string, number> = {};
  for (let j = 0; j < ev.length; j++) {
    const g = areas[ev[j].i][key];
    sw[g] = (sw[g] ?? 0) + w[j];
    swr[g] = (swr[g] ?? 0) + w[j] * (resid[j] + (u[g] ?? 0));
  }
  const groups = Object.keys(sw).filter((g) => sw[g] > 0);
  if (groups.length < (key === 'uf' ? 6 : 3)) return 0;
  let s = 0;
  for (const g of groups) s += sq(swr[g] / sw[g]) - 1 / sw[g];
  return Math.max(0, s / groups.length);
}

/**
 * Depois de cada ciclo: guarda o primeiro parcial de cada cidade, fecha pares parcial→final (deriva) e compara
 * a previsão feita antes de a cidade ter voto com o que chegou (autoavaliação). Muta `learn`.
 */
export function updateLearn(learn: ProjLearn, model: ProjModel, obs: (ProjObs | null | undefined)[], res: ProjResult | null) {
  const sw2 = sq(res?.diag?.sigmaDrift ?? PROJ_PARAMS.sigmaDrift);
  const dm = res?.diag?.driftMean ?? 0;
  const frozen = (learn.frozen ??= {});
  model.areas.forEach((a, i) => {
    const s = obs[i]?.snap;
    if (!s) return;
    const m = s.a + s.b;
    if (m < PROJ_PARAMS.minVotes) return;
    const q = (s.a + 0.5) / (m + 1);
    const y = logit(q);
    const f = clamp(s.elc / Math.max(1, a.el), 0, 1);
    const last = (learn.last ??= {});
    const steps = (learn.steps ??= []);
    const prev = last[a.id];
    if (!prev) last[a.id] = [f, y, m];
    else if (f >= prev[0] + 0.05) {
      const qp = expit(prev[1]);
      steps.push([f - prev[0], prev[1] - y, 1 / Math.max(1, prev[2] * qp * (1 - qp)) + 1 / (m * q * (1 - q))]);
      if (f >= 0.999) delete last[a.id];
      else last[a.id] = [f, y, m];
    }
    const first = learn.first[a.id];
    if (!first && f >= 0.03 && f <= 0.9) learn.first[a.id] = [f, y, m];
    else if (first && first[0] >= 0 && f >= 0.999) {
      learn.drift.push([first[0], first[1], y, first[2]]);
      learn.first[a.id] = [-1, 0, 0];
    }
    const pr = learn.pred[a.id];
    if (pr) {
      frozen[a.id] = 1;
      // conferida com 60%+ apurado: o erro conta com o ruído do parcial e a deriva das seções que faltam
      if (f >= 0.6) {
        learn.errs.push([y - dm * (1 - f) - pr[0], pr[1] + 1 / (m * q * (1 - q)) + sw2 * (1 - f), pr[2]]);
        delete learn.pred[a.id];
      }
    }
  });
  if (res) {
    for (const [i, v] of res.pending) {
      const id = model.areas[i].id;
      if (!frozen[id]) learn.pred[id] = v;
    }
  }
  if (learn.drift.length > MAX_LEARN) learn.drift.splice(0, learn.drift.length - MAX_LEARN);
  if (learn.errs.length > MAX_LEARN) learn.errs.splice(0, learn.errs.length - MAX_LEARN);
  if (learn.steps && learn.steps.length > MAX_LEARN) learn.steps.splice(0, learn.steps.length - MAX_LEARN);
}
