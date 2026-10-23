// Cálculos do placar: "precisa de X% do que falta", status, projeção, transferência, virada vs 2022.
import type {
  CandidateDef,
  ElectionStatus,
  HistRow,
  ParsedResult,
  Projection,
  RemainingRow,
  ScopeKey,
  Side,
  Snap,
} from './types';

/** comparecimento e % de válidos usados quando ainda não há nada apurado no escopo */
export const DEFAULT_TURNOUT = 0.79;
export const DEFAULT_VALID = 0.95;

export interface Rates {
  turnout: number;
  valid: number;
}

/** taxas de comparecimento e de votos válidos a partir de uma linha histórica (1º turno) */
export function ratesFromHistory(h?: HistRow | null): Rates | undefined {
  if (!h || !h.el || !h.turnout) return undefined;
  return { turnout: h.turnout / h.el, valid: h.valid / h.turnout };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function scopeKey(p: Pick<ParsedResult, 'scope' | 'code'>, ibge?: string): ScopeKey {
  if (p.scope === 'br') return 'br';
  if (p.scope === 'uf') return `uf:${p.code}`;
  return `mun:${ibge ?? p.code}`;
}

/**
 * Votos válidos esperados no que falta apurar.
 * Usa o comparecimento já observado no escopo; sem dado ainda, cai para o 1º turno.
 */
export function expectedRemaining(
  el: number,
  elc: number,
  turnout: number,
  valid: number,
  fallback: Rates = { turnout: DEFAULT_TURNOUT, valid: DEFAULT_VALID },
): number {
  const left = Math.max(0, el - elc);
  if (left === 0) return 0;
  // com pouca amostra o comparecimento parcial é ruidoso: mistura com o fallback
  const w = elc > 0 ? Math.min(1, elc / Math.max(1, el) / 0.2) : 0;
  const t = elc > 0 ? turnout / elc : fallback.turnout;
  const v = turnout > 0 ? valid / turnout : fallback.valid;
  const tr = w * t + (1 - w) * fallback.turnout;
  const vr = w * v + (1 - w) * fallback.valid;
  return Math.round(left * tr * vr);
}

/**
 * Fração (0–100) dos votos válidos restantes que o candidato atrás precisa para virar.
 * Atrás precisa de x tal que x·R − (1−x)·R > lead  ⇒  x > (lead + R) / 2R.
 */
export function needPct(lead: number, rem: number): number | null {
  if (rem <= 0) return null;
  return round2(((Math.abs(lead) + rem) / (2 * rem)) * 100);
}

/**
 * "Matematicamente definido" usa o teto absoluto: todo o eleitorado não apurado votando
 * validamente no candidato atrás. Só isso garante que não há virada possível.
 */
export function isMathDefined(lead: number, rmax: number): boolean {
  return Math.abs(lead) > rmax;
}

export function toSnap(
  p: ParsedResult,
  cands: CandidateDef[],
  opts: { key?: ScopeKey; fallback?: Rates; rem?: number } = {},
): Snap {
  const [ca, cb] = cands;
  const a = p.votes[ca.n] ?? 0;
  const b = p.votes[cb.n] ?? 0;
  const valid2 = a + b;
  const rmax = Math.max(0, p.el - p.elc);
  const rem = opts.rem ?? expectedRemaining(p.el, p.elc, p.turnout, valid2 || p.valid, opts.fallback);
  const diff = a - b;
  const lead: Side | null = diff > 0 ? 'a' : diff < 0 ? 'b' : null;
  let status: ElectionStatus = 'apurando';
  if (p.totalized) status = 'totalizado';
  else if (valid2 === 0 && p.pst === 0) status = 'nao_iniciada';
  else if (lead && isMathDefined(diff, rmax)) status = 'definido';
  return {
    s: opts.key ?? scopeKey(p),
    at: p.at,
    pst: round2(p.pst),
    a,
    b,
    pa: valid2 ? round2((a / valid2) * 100) : 0,
    pb: valid2 ? round2((b / valid2) * 100) : 0,
    valid: valid2,
    blank: p.blank,
    nulls: p.nulls,
    el: p.el,
    elc: p.elc,
    turnout: p.turnout,
    status,
    lead,
    need: status === 'apurando' && lead ? needPct(diff, rem) : null,
    rem,
    rmax,
  };
}

/** Recalcula `rem`/`need` de um snapshot com um "restante" vindo de outra fonte (ex.: soma por UF). */
export function withRemaining(s: Snap, rem: number): Snap {
  const diff = s.a - s.b;
  return { ...s, rem, need: s.status === 'apurando' && s.lead ? needPct(diff, rem) : null };
}

/** % de A no confronto direto A×B de uma linha histórica */
export function twoWay(h: HistRow | undefined | null, cands: CandidateDef[]): number | null {
  if (!h) return null;
  const a = h.votes[cands[0].n] ?? 0;
  const b = h.votes[cands[1].n] ?? 0;
  return a + b > 0 ? round2((a / (a + b)) * 100) : null;
}

/** "Onde ainda falta": UFs ordenadas por votos restantes */
export function remainingRows(
  ufs: Record<string, Snap>,
  hist1: Record<string, HistRow> | undefined,
  cands: CandidateDef[],
): RemainingRow[] {
  return Object.entries(ufs)
    .map(([key, s]) => {
      const uf = key.replace(/^uf:/, '');
      return {
        uf,
        pst: s.pst,
        rem: s.rem,
        pa1: twoWay(hist1?.[uf], cands),
        pa: s.valid ? s.pa : null,
      };
    })
    .filter((r) => r.rem > 0)
    .sort((x, y) => y.rem - x.rem);
}

/**
 * Projeção simples (sempre rotulada "estimativa"):
 * swing = quanto A está acima/abaixo do seu confronto direto do 1º turno nas UFs já apuradas;
 * o restante de cada UF segue a média entre o parcial da UF e (1º turno + swing).
 * Devolve intervalo, nunca um número seco.
 */
export function project(
  br: Snap,
  ufs: Record<string, Snap>,
  hist1: Record<string, HistRow> | undefined,
  cands: CandidateDef[],
  opts: { minPst?: number; band?: number } = {},
): Projection | null {
  const minPst = opts.minPst ?? 20;
  const band = opts.band ?? 3;
  if (br.pst < minPst || br.status === 'totalizado') return null;
  let wsum = 0;
  let swing = 0;
  for (const [key, s] of Object.entries(ufs)) {
    const pa1 = twoWay(hist1?.[key.slice(3)], cands);
    if (pa1 === null || !s.valid) continue;
    swing += (s.pa - pa1) * s.valid;
    wsum += s.valid;
  }
  swing = wsum ? swing / wsum : 0;
  let addA = 0;
  let addAll = 0;
  for (const [key, s] of Object.entries(ufs)) {
    if (s.rem <= 0) continue;
    const pa1 = twoWay(hist1?.[key.slice(3)], cands);
    const prior = pa1 === null ? br.pa : pa1 + swing;
    const est = s.pst >= 10 && s.valid ? (s.pa + prior) / 2 : prior;
    addA += (s.rem * Math.min(100, Math.max(0, est))) / 100;
    addAll += s.rem;
  }
  const total = br.valid + addAll;
  if (!total) return null;
  const pa = ((br.a + addA) / total) * 100;
  const delta = ((addAll * band) / 100 / total) * 100;
  return { pa: round2(pa), lo: round2(pa - delta), hi: round2(pa + delta), basedOnPst: br.pst };
}

export interface Transfer {
  /** votos que A e B ganharam em relação ao 1º turno (na parte apurada) */
  gainA: number;
  gainB: number;
  /** estoque: votos dos eliminados + brancos/nulos + abstenção que virou voto */
  stock: number;
  /** ganhos como % do estoque */
  pctA: number | null;
  pctB: number | null;
  /** fator de escala aplicado ao 1º turno (fração do eleitorado já apurada) */
  scale: number;
}

export function transfer(now: Snap, t1: HistRow, cands: CandidateDef[]): Transfer {
  const f = now.el ? Math.min(1, now.elc / now.el) : 1;
  const a1 = (t1.votes[cands[0].n] ?? 0) * f;
  const b1 = (t1.votes[cands[1].n] ?? 0) * f;
  const others1 = t1.valid * f - a1 - b1;
  const abst2 = Math.max(0, now.elc - now.turnout);
  const stock = others1 + (t1.blank + t1.nulls) * f + (t1.abst * f - abst2);
  const gainA = now.a - a1;
  const gainB = now.b - b1;
  return {
    gainA: Math.round(gainA),
    gainB: Math.round(gainB),
    stock: Math.round(stock),
    pctA: stock > 0 ? round2((gainA / stock) * 100) : null,
    pctB: stock > 0 ? round2((gainB / stock) * 100) : null,
    scale: round2(f),
  };
}

/** lado vencedor numa linha histórica, usando o mapeamento de números do ano (ex.: 2022) */
export function histLead(h: HistRow | undefined | null, map: Record<Side, string>): Side | null {
  if (!h) return null;
  const a = h.votes[map.a] ?? 0;
  const b = h.votes[map.b] ?? 0;
  return a > b ? 'a' : b > a ? 'b' : null;
}

/** Virou de lado vs 2022: sinal(A−B) agora ≠ sinal(A−B) em 2022 */
export function flipped(
  now: Snap,
  past: HistRow | undefined | null,
  map: Record<Side, string>,
): { from: Side; to: Side } | null {
  const before = histLead(past, map);
  if (!before || !now.lead || before === now.lead) return null;
  return { from: before, to: now.lead };
}

export const fmtPct = (x: number, digits = 2) =>
  x.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtInt = (x: number) => Math.round(x).toLocaleString('pt-BR');
