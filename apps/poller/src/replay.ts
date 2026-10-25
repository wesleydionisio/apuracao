// Simulador da noite de apuração: gera JSONs no MESMO formato do TSE, então o pipeline inteiro
// (parser → cálculos → momentos → JSON estático → WS) é exercitado como no domingo.
// Base: 1º turno 2026 por UF/município (ETL) ou, sem ETL, as fixtures reais do repositório.
//
// Dois modos:
//  - roteiro (padrão, scenarios/<nome>.json): a margem nacional segue pontos (% apurado → margem);
//    cada cidade mantém a geografia do 1º turno e um ajuste nacional δ(t), aplicado só às seções que entram
//    naquele instante, leva o total ao roteiro.
//  - "aleatorio": vieses sorteados por estado (viradas espontâneas).
// A contagem é cumulativa (voto contado não muda) e as UFs e o Brasil são a soma das cidades, então o andamento
// por cidade bate com os arquivos das UFs, como no TSE (a projeção por cidade depende disso).
// O relógio é controlável (play/pausa/velocidade/ir para t) — usado pela barra de debug local.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseProgress, parseResult, twoWay, UF_REGION, type CandidateDef, type HistRow } from '@apuracao/shared';
import type { Config } from './config';
import type { History } from './history';
import type { Source } from './source';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

interface Area {
  el: number;
  tr: number; // comparecimento
  fa: number; // % final de A
  bias: number; // viés das primeiras seções (só no modo aleatório; diminui conforme a área é apurada)
  delay: number; // 0–1 da noite
  span: number; // duração relativa da apuração
}

export interface Scenario {
  nome: string;
  /** número do candidato cuja margem o roteiro descreve */
  candidato: string;
  /** [% apurado no Brasil, margem em pontos (candidato − adversário)] */
  margem?: [number, number][];
  /**
   * Alternativa realista ao `margem`: só a margem final; a curva da noite sai da ordem de chegada
   * (`atraso`: fração da noite que cada região começa depois, ex. { "NE": 0.08 }), como numa apuração de verdade.
   */
  final?: number;
  atraso?: Record<string, number>;
}

/** fim da noite simulada; um pouco depois de 1 o TSE marca totalização */
export const T_END = 1.05;
const T_TOTAL = 1.03;
const DURATION_H = 3.5; // 17h → 20h30 em tempo "virtual"
const VALID = 0.955;

export interface ReplayStatus {
  scenario: string;
  t: number;
  playing: boolean;
  speed: number;
  minutes: number;
}

export class ReplaySource implements Source {
  readonly name = 'replay';
  private ufs = new Map<string, Area>();
  private mun = new Map<string, Area & { uf: string }>();
  /** códigos TSE dos municípios de cada UF (para o arquivo de andamento da UF) */
  private munByUf = new Map<string, string[]>();
  private cands: { n: string; name: string; seq: number; sq?: string; party?: string }[];
  private scenario: Scenario | null;
  /** roteiro em termos de % de A (primeiro candidato) */
  private targetA: ((pst: number) => number) | null = null;
  /** roteiro realista: % final de A (o δ é o mesmo a noite inteira) */
  private finalA: number | null = null;
  private clock = { playing: true, speed: 1, base: 0, wall: Date.now() };

  constructor(
    private cfg: Config,
    hist: History,
  ) {
    const fx = (f: string) => JSON.parse(readFileSync(path.join(cfg.repo, 'packages/data/fixtures', f), 'utf8'));
    const t2 = parseResult(fx('t2-br.json'));
    this.cands = Object.entries(t2.names)
      .map(([n, v]) => ({ n, name: v.name, seq: v.seq, sq: v.sq, party: v.party }))
      .sort((x, y) => x.seq - y.seq);
    const cd: CandidateDef[] = this.cands.map((c, i) => ({
      key: i === 0 ? 'a' : 'b', n: c.n, name: c.name, short: c.name, color: '',
    }));
    this.scenario = loadScenario(cfg);
    if (this.scenario) {
      const sign = this.scenario.candidato === this.cands[0].n ? 1 : -1;
      if (this.scenario.margem?.length) {
        const pts = [...this.scenario.margem].sort((x, y) => x[0] - y[0]);
        this.targetA = (pst) => 50 + (sign * interp(pts, pst)) / 2;
      } else if (typeof this.scenario.final === 'number') this.finalA = 50 + (sign * this.scenario.final) / 2;
    }
    const scripted = !!this.targetA || this.finalA !== null;
    const r = rng(cfg.replay.seed);
    const swing = (r() - 0.5) * 3;
    // viés nacional das primeiras urnas no modo aleatório (como 2022: um lado larga na frente e o outro vira)
    const early = (r() < 0.5 ? -1 : 1) * (5 + r() * 6);

    const t1br = parseResult(fx('t1-br.json'));
    const brRow: HistRow = { ...t1br, votes: t1br.votes };
    const ufRows: Record<string, HistRow> =
      hist.t1?.uf ??
      Object.fromEntries(
        parseProgress(fx('t2-br-ab.json'))
          .filter((p) => p.uf !== 'BR')
          .map((p) => [p.uf, { ...brRow, el: p.el, turnout: p.el * 0.79 }]),
      );
    for (const [uf, h] of Object.entries(ufRows)) {
      const u = rng(cfg.replay.seed ^ hash(uf));
      const pa1 = twoWay(h, cd) ?? 50;
      // sem ETL todas as UFs teriam o mesmo 1º turno: espalha para o mapa ficar com cara de Brasil
      const spread = hist.t1 ? 0 : (u() - 0.5) * 24;
      this.ufs.set(uf, {
        el: h.el,
        tr: h.el ? clamp(h.turnout / h.el, 0.5, 0.95) : 0.79,
        fa: clamp(pa1 + spread + (scripted ? 0 : swing) + (u() - 0.5) * 3, 5, 95),
        bias: scripted ? 0 : early + (u() - 0.5) * 6,
        // no roteiro os estados começam quase juntos: o total já nasce perto da média nacional
        delay: u() * (scripted ? 0.03 : 0.08) + (this.scenario?.atraso?.[UF_REGION[uf] ?? ''] ?? 0),
        span: 0.45 + u() * 0.45,
      });
    }
    for (const m of hist.municipalities) {
      const h = hist.t1Mun[m.ibge];
      const parent = this.ufs.get(m.uf);
      if (!h || !parent) continue;
      const u = rng(cfg.replay.seed ^ hash(m.ibge));
      const ufPa1 = twoWay(ufRows[m.uf], cd) ?? 50;
      const pa1 = twoWay(h, cd) ?? ufPa1;
      (this.munByUf.get(m.uf) ?? this.munByUf.set(m.uf, []).get(m.uf)!).push(m.tse);
      this.mun.set(`${m.uf}:${m.tse}`, {
        uf: m.uf,
        el: h.el,
        tr: h.el ? clamp(h.turnout / h.el, 0.5, 0.95) : parent.tr,
        fa: clamp(parent.fa + (pa1 - ufPa1) + (u() - 0.5) * 2, 2, 98),
        bias: parent.bias + (scripted ? 0 : (u() - 0.5) * 4),
        delay: clamp(parent.delay + (u() - 0.3) * 0.1, 0, 0.3),
        // poucas seções acabam cedo: cidade pequena fecha em ~15% do tempo do estado, capital usa tudo
        span: clamp((parent.span + (u() - 0.5) * 0.3) * clamp((h.el / 200_000) ** 0.35, 0.15, 1), 0.04, 0.95),
      });
    }
    this.buildGrid();
    console.log(
      `[replay] ${this.ufs.size} UFs, ${this.mun.size} municípios, noite de ${cfg.replay.minutes} min, ${
        this.scenario ? `roteiro "${this.scenario.nome}"` : 'modo aleatório'
      }`,
    );
  }

  // ---------- relógio controlável ----------

  /** 0 → 1 ao longo da noite simulada (passa um pouco de 1 para fechar a totalização) */
  t(): number {
    if (this.frozen !== null) return this.frozen;
    const c = this.clock;
    if (!c.playing) return c.base;
    return clamp(c.base + ((Date.now() - c.wall) / (this.cfg.replay.minutes * 60_000)) * c.speed, 0, T_END);
  }

  /** um ciclo do poller lê BR, UFs e andamento no mesmo instante (no TSE os arquivos saem juntos) */
  private frozen: number | null = null;
  freeze() {
    this.frozen = null;
    this.frozen = this.t();
  }
  thaw() {
    this.frozen = null;
  }

  setT(t: number) {
    this.clock.base = clamp(t, 0, T_END);
    this.clock.wall = Date.now();
  }

  setPlaying(playing: boolean) {
    this.setT(this.t());
    this.clock.playing = playing;
  }

  setSpeed(speed: number) {
    this.setT(this.t());
    this.clock.speed = clamp(speed, 0.1, 500);
  }

  status(): ReplayStatus {
    return {
      scenario: this.scenario?.nome ?? 'aleatório',
      t: this.t(),
      playing: this.clock.playing,
      speed: this.clock.speed,
      minutes: this.cfg.replay.minutes,
    };
  }

  /** % apurado no Brasil num instante t */
  pstAt(t: number): number {
    return this.br.at(this.step(t)).pst;
  }

  /** instante t em que o Brasil chega a `target` % apurado (busca binária; pst cresce com t) */
  tForPst(target: number): number {
    if (target <= 0) return 0;
    if (target >= 100) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (this.pstAt(mid) < target) lo = mid;
      else hi = mid;
    }
    return hi;
  }

  // ---------- modelo ----------
  //
  // Contagem cumulativa, como no TSE: cada cidade apura seções ao longo da noite e o voto de uma seção não muda
  // depois de contado. O roteiro nacional vira um ajuste δ aplicado só às seções que entram em cada passo, e as
  // UFs e o Brasil são a soma das cidades (o andamento por cidade bate com os arquivos das UFs).

  private pst(a: Area, t: number) {
    if (t >= 1) return 100;
    const u = clamp((t - a.delay) / a.span, 0, 1);
    return 100 * (1 - (1 - u) ** 2);
  }

  /** passo da grade para um instante t */
  private step(t: number) {
    return Math.round(clamp(t, 0, 1) * GRID);
  }

  /** áreas que apuram de fato: as cidades (ou, sem ETL, as UFs inteiras) */
  private areas: (Area & { uf: string })[] = [];
  /** δ do roteiro aplicado às seções que entram em cada passo */
  private delta = new Float64Array(GRID + 1);
  private ufAcc = new Map<string, Acc>();
  private br: Acc = newAcc(0);

  private buildGrid() {
    this.areas = this.mun.size ? [...this.mun.values()] : [...this.ufs].map(([uf, a]) => ({ ...a, uf }));
    const acc = (uf: string) => this.ufAcc.get(uf) ?? this.ufAcc.set(uf, newAcc(0)).get(uf)!;
    for (const a of this.areas) {
      acc(a.uf).el += a.el;
      this.br.el += a.el;
    }
    const A = new Float64Array(this.areas.length);
    const V = new Float64Array(this.areas.length);
    let sumA = 0;
    // roteiro realista: um δ só, que leva o resultado final ao roteiro (a forma da curva vem da ordem de chegada)
    let d0 = 0;
    if (this.finalA !== null) {
      let v = 0;
      let va = 0;
      for (const a of this.areas) {
        v += a.el * a.tr;
        va += (a.el * a.tr * a.fa) / 100;
      }
      d0 = v ? this.finalA - (va / v) * 100 : 0;
    }
    for (let k = 1; k <= GRID; k++) {
      const t = k / GRID;
      const tm = (k - 0.5) / GRID;
      // incrementos do passo e a % de A "natural" de cada um
      let dVsum = 0;
      let dAsum = 0;
      let Vsum = 0;
      const dV = new Float64Array(this.areas.length);
      const sh = new Float64Array(this.areas.length);
      this.areas.forEach((a, i) => {
        const v = (a.el * this.pst(a, t) * a.tr * VALID) / 100;
        dV[i] = v - V[i];
        sh[i] = clamp(a.fa + a.bias * (1 - this.pst(a, tm) / 100), 1, 99);
        dVsum += dV[i];
        dAsum += (dV[i] * sh[i]) / 100;
        Vsum += v;
      });
      const pstBr = this.br.el ? (this.areas.reduce((s2, a) => s2 + a.el * this.pst(a, t), 0) / this.br.el) : 0;
      const d = this.targetA && dVsum > 0 ? ((this.targetA(pstBr) * Vsum) / 100 - sumA - dAsum) / dVsum * 100 : d0;
      this.delta[k] = clamp(d, -30, 30);
      for (const x of this.ufAcc.values()) x.push(k);
      this.br.push(k);
      this.areas.forEach((a, i) => {
        const da = (dV[i] * clamp(sh[i] + this.delta[k], 1, 99)) / 100;
        A[i] += da;
        V[i] += dV[i];
        sumA += da;
        const elc = (a.el * this.pst(a, t)) / 100;
        for (const x of [acc(a.uf), this.br]) x.add(k, elc, elc * a.tr, dV[i], da);
      });
    }
  }

  /** contagem de uma cidade no passo k (refaz a soma dos incrementos; só ~150 cidades por ciclo) */
  private cityAt(a: Area, k: number) {
    let va = 0;
    let vPrev = 0;
    for (let j = 1; j <= k; j++) {
      const v = (a.el * this.pst(a, j / GRID) * a.tr * VALID) / 100;
      const sh = clamp(a.fa + a.bias * (1 - this.pst(a, (j - 0.5) / GRID) / 100) + this.delta[j], 1, 99);
      va += ((v - vPrev) * sh) / 100;
      vPrev = v;
    }
    const pst = this.pst(a, k / GRID);
    return countsOf({ el: a.el, elc: (a.el * pst) / 100, turnout: (a.el * pst * a.tr) / 100, valid: vPrev, va });
  }

  /** <uf>-e<ele>-ab.json: andamento de cada cidade; a hora só muda quando entra seção nova (como no TSE) */
  private progressUf(uf: string, t: number) {
    return {
      ele: this.cfg.tse.code,
      abr: (this.munByUf.get(uf) ?? []).map((tse) => {
        const a = this.mun.get(`${uf}:${tse}`)!;
        const pst = this.pst(a, this.step(t) / GRID);
        const elc = Math.round((a.el * pst) / 100);
        const ts = Math.max(1, Math.round(a.el / 320));
        const st = Math.round((ts * pst) / 100);
        const secs = 17 * 3600 + st; // monotônico em st: muda só com seção nova
        const ht = [Math.floor(secs / 3600), Math.floor(secs / 60) % 60, secs % 60].map((v) => String(v).padStart(2, '0')).join(':');
        return {
          tpabr: 'mun',
          cdabr: tse,
          dt: '25/10/2026',
          ht: st ? ht : '',
          s: { ts: String(ts), st: String(st), pstn: ((st / ts) * 100).toFixed(2).replace('.', ',') },
          e: { te: String(a.el), est: String(elc), c: String(Math.round(elc * a.tr)) },
        };
      }),
    };
  }

  async get(p: string): Promise<unknown | null> {
    const ab = /\/(\d+)\/dados\/([a-z]{2})\/([a-z]{2})-e\d+-ab\.json$/.exec(p);
    if (ab) {
      if (ab[1] !== this.cfg.tse.code || ab[3] === 'br') return null;
      return this.progressUf(ab[3].toUpperCase(), this.t());
    }
    const m = /\/(\d+)\/dados\/([a-z]{2})\/([a-z]{2})(\d*)-c0001-e\d+-u\.json$/.exec(p);
    if (!m || m[1] !== this.cfg.tse.code) return null;
    const t = this.t();
    const k = this.step(t);
    const uf = m[3].toUpperCase();
    const munCode = m[4];
    const clock = new Date(Date.parse('2026-10-25T20:00:00Z') + clamp(t, 0, T_END) * DURATION_H * 3_600_000);
    const done = t >= T_TOTAL;
    let c: Counts;
    if (m[2] === 'br') c = this.br.at(k);
    else if (munCode) {
      const a = this.mun.get(`${uf}:${munCode}`);
      if (!a) return null;
      c = this.cityAt(a, k);
    } else {
      const x = this.ufAcc.get(uf);
      if (!x) return null;
      c = x.at(k);
    }
    return fakeTse({
      ele: this.cfg.tse.code,
      tpabr: m[2] === 'br' ? 'br' : munCode ? 'mu' : 'uf',
      cdabr: munCode || m[3],
      clock,
      done,
      cands: this.cands.map((x, i) => ({ ...x, vap: i === 0 ? c.va : c.vb })),
      ...c,
    });
  }
}

/** passos da grade da noite (t de 0 a 1) */
const GRID = 600;

type Counts = ReturnType<typeof countsOf>;

function countsOf(x: { el: number; elc: number; turnout: number; valid: number; va: number }) {
  const elc = Math.round(x.elc);
  const turnout = Math.round(x.turnout);
  const valid = Math.round(x.valid);
  const blank = Math.round(turnout * 0.016);
  const va = Math.round(x.va);
  return { pst: x.el ? (x.elc / x.el) * 100 : 0, el: x.el, elc, turnout, valid, blank, nulls: Math.max(0, turnout - valid - blank), va, vb: valid - va };
}

/** somas cumulativas de uma UF (ou do Brasil) em cada passo da grade */
interface Acc {
  el: number;
  /** começo do passo k: válidos e votos de A continuam do passo anterior (eleitorado apurado é refeito) */
  push(k: number): void;
  add(k: number, elc: number, turnout: number, dValid: number, dA: number): void;
  at(k: number): Counts;
}

function newAcc(el: number): Acc {
  const mk = () => new Float64Array(GRID + 1);
  const elc = mk();
  const turnout = mk();
  const valid = mk();
  const va = mk();
  return {
    el,
    push(k) {
      valid[k] = valid[k - 1];
      va[k] = va[k - 1];
    },
    add(k, e, t, dValid, dA) {
      elc[k] += e;
      turnout[k] += t;
      valid[k] += dValid;
      va[k] += dA;
    },
    at(k) {
      return countsOf({ el: this.el, elc: elc[k], turnout: turnout[k], valid: valid[k], va: va[k] });
    },
  };
}

function loadScenario(cfg: Config): Scenario | null {
  const name = cfg.replay.scenario;
  if (!name || name === 'aleatorio') return null;
  const file = path.join(cfg.repo, 'apps/poller/scenarios', `${name}.json`);
  if (!existsSync(file)) {
    console.warn(`[replay] roteiro ${file} não existe — usando modo aleatório`);
    return null;
  }
  return JSON.parse(readFileSync(file, 'utf8')) as Scenario;
}

/** interpolação linear por partes */
function interp(pts: [number, number][], x: number): number {
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

const s = (n: number) => String(Math.round(n));
const pc = (n: number) => n.toFixed(9).replace('.', ',');

function fakeTse(o: {
  ele: string;
  tpabr: string;
  cdabr: string;
  clock: Date;
  done: boolean;
  cands: { n: string; name: string; seq: number; sq?: string; party?: string; vap: number }[];
  pst: number;
  el: number;
  elc: number;
  turnout: number;
  valid: number;
  blank: number;
  nulls: number;
}) {
  const brt = new Date(o.clock.getTime() - 3 * 3_600_000).toISOString();
  const dt = `${brt.slice(8, 10)}/${brt.slice(5, 7)}/${brt.slice(0, 4)}`;
  const ht = brt.slice(11, 19);
  const ts = Math.max(1, Math.round(o.el / 320));
  return {
    ele: o.ele, t: '2', f: 's', tpabr: o.tpabr, cdabr: o.cdabr, dg: dt, hg: ht, dt, ht,
    tf: o.done ? 's' : 'n', and: o.done ? 'f' : o.pst > 0 ? 'p' : 'n',
    carg: [{
      cd: '1', agr: o.cands.map((c) => ({
        par: [{ sg: c.party ?? '', cand: [{ n: c.n, nmu: c.name, nm: c.name, seq: String(c.seq), sqcand: c.sq, vap: s(c.vap),
          pvapn: pc(o.valid ? (c.vap / o.valid) * 100 : 0) }] }],
      })),
    }],
    s: { ts: s(ts), st: s((ts * o.pst) / 100), pstn: pc(o.pst) },
    e: { te: s(o.el), est: s(o.elc), c: s(o.turnout), a: s(o.elc - o.turnout) },
    v: { vv: s(o.valid), vb: s(o.blank), tvn: s(o.nulls) },
  };
}
