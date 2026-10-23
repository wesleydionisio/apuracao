// Simulador da noite de apuração: gera JSONs no MESMO formato do TSE, então o pipeline inteiro
// (parser → cálculos → momentos → JSON estático → WS) é exercitado como no domingo.
// Base: 1º turno 2026 por UF/município (ETL) ou, sem ETL, as fixtures reais do repositório.
//
// Dois modos:
//  - roteiro (padrão, scenarios/<nome>.json): a margem nacional segue pontos (% apurado → margem);
//    cada estado mantém a geografia do 1º turno e um ajuste nacional δ(t) leva o total ao roteiro.
//  - "aleatorio": vieses sorteados por estado (viradas espontâneas).
// O relógio é controlável (play/pausa/velocidade/ir para t) — usado pela barra de debug local.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseProgress, parseResult, twoWay, type CandidateDef, type HistRow } from '@apuracao/shared';
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
  bias: number; // viés das primeiras seções (só no modo aleatório; some quando chega a 100%)
  delay: number; // 0–1 da noite
  span: number; // duração relativa da apuração
}

export interface Scenario {
  nome: string;
  /** número do candidato cuja margem o roteiro descreve */
  candidato: string;
  /** [% apurado no Brasil, margem em pontos (candidato − adversário)] */
  margem: [number, number][];
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
  private cands: { n: string; name: string; seq: number; sq?: string; party?: string }[];
  private scenario: Scenario | null;
  /** roteiro em termos de % de A (primeiro candidato) */
  private targetA: ((pst: number) => number) | null = null;
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
      const pts = [...this.scenario.margem].sort((x, y) => x[0] - y[0]);
      this.targetA = (pst) => 50 + (sign * interp(pts, pst)) / 2;
    }
    const scripted = !!this.targetA;
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
        delay: u() * (scripted ? 0.03 : 0.08),
        span: 0.45 + u() * 0.45,
      });
    }
    // calibra o resultado final dos estados para fechar exatamente no roteiro
    if (this.targetA) {
      for (let i = 0; i < 3; i++) {
        const final = this.share(1, 0).sA;
        const adj = this.targetA(100) - final;
        for (const a of this.ufs.values()) a.fa = clamp(a.fa + adj, 2, 98);
      }
    }
    for (const m of hist.municipalities) {
      const h = hist.t1Mun[m.ibge];
      const parent = this.ufs.get(m.uf);
      if (!h || !parent) continue;
      const u = rng(cfg.replay.seed ^ hash(m.ibge));
      const ufPa1 = twoWay(ufRows[m.uf], cd) ?? 50;
      const pa1 = twoWay(h, cd) ?? ufPa1;
      this.mun.set(`${m.uf}:${m.tse}`, {
        uf: m.uf,
        el: h.el,
        tr: h.el ? clamp(h.turnout / h.el, 0.5, 0.95) : parent.tr,
        fa: clamp(parent.fa + (pa1 - ufPa1) + (u() - 0.5) * 2, 2, 98),
        bias: parent.bias + (scripted ? 0 : (u() - 0.5) * 4),
        delay: clamp(parent.delay + (u() - 0.3) * 0.1, 0, 0.3),
        span: clamp(parent.span + (u() - 0.5) * 0.3, 0.2, 0.95),
      });
    }
    console.log(
      `[replay] ${this.ufs.size} UFs, ${this.mun.size} municípios, noite de ${cfg.replay.minutes} min, ${
        this.scenario ? `roteiro "${this.scenario.nome}"` : 'modo aleatório'
      }`,
    );
  }

  // ---------- relógio controlável ----------

  /** 0 → 1 ao longo da noite simulada (passa um pouco de 1 para fechar a totalização) */
  t(): number {
    const c = this.clock;
    if (!c.playing) return c.base;
    return clamp(c.base + ((Date.now() - c.wall) / (this.cfg.replay.minutes * 60_000)) * c.speed, 0, T_END);
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
    let el = 0;
    let elc = 0;
    for (const a of this.ufs.values()) {
      el += a.el;
      elc += (a.el * this.pst(a, t)) / 100;
    }
    return el ? (elc / el) * 100 : 0;
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

  private pst(a: Area, t: number) {
    const u = clamp((t - a.delay) / a.span, 0, 1);
    return 100 * (1 - (1 - u) ** 2);
  }

  /** % de A na parte apurada de uma área, dado o ajuste nacional δ */
  private areaShare(a: Area, pst: number, delta: number) {
    return clamp(a.fa + a.bias * (1 - pst / 100) + delta, 1, 99);
  }

  /** % de A nacional na parte apurada (sem δ) e o δ que leva ao roteiro */
  private share(t: number, delta = 0): { sA: number; pst: number } {
    let v = 0;
    let va = 0;
    let el = 0;
    let elc = 0;
    for (const a of this.ufs.values()) {
      const p = this.pst(a, t);
      const valid = (a.el * p * a.tr * VALID) / 100;
      v += valid;
      va += (valid * this.areaShare(a, p, delta)) / 100;
      el += a.el;
      elc += (a.el * p) / 100;
    }
    return { sA: v ? (va / v) * 100 : 50, pst: el ? (elc / el) * 100 : 0 };
  }

  private deltaAt(t: number): number {
    if (!this.targetA) return 0;
    const { sA, pst } = this.share(t);
    return this.targetA(pst) - sA;
  }

  private counts(a: Area, t: number, delta: number) {
    const pst = this.pst(a, t);
    const elc = Math.round((a.el * pst) / 100);
    const turnout = Math.round(elc * a.tr);
    const valid = Math.round(turnout * VALID);
    const blank = Math.round(turnout * 0.016);
    const va = Math.round((valid * this.areaShare(a, pst, delta)) / 100);
    return { pst, el: a.el, elc, turnout, valid, blank, nulls: turnout - valid - blank, va, vb: valid - va };
  }

  async get(p: string): Promise<unknown | null> {
    const m = /\/(\d+)\/dados\/([a-z]{2})\/([a-z]{2})(\d*)-c0001-e\d+-u\.json$/.exec(p);
    if (!m || m[1] !== this.cfg.tse.code) return null;
    const t = this.t();
    const delta = this.deltaAt(t);
    const uf = m[3].toUpperCase();
    const munCode = m[4];
    const clock = new Date(Date.parse('2026-10-25T20:00:00Z') + clamp(t, 0, T_END) * DURATION_H * 3_600_000);
    const done = t >= T_TOTAL;
    let c: ReturnType<ReplaySource['counts']>;
    if (m[2] === 'br') {
      c = { pst: 0, el: 0, elc: 0, turnout: 0, valid: 0, blank: 0, nulls: 0, va: 0, vb: 0 };
      for (const a of this.ufs.values()) {
        const x = this.counts(a, t, delta);
        for (const k of Object.keys(c) as (keyof typeof c)[]) if (k !== 'pst') c[k] += x[k];
      }
      c.pst = c.el ? (c.elc / c.el) * 100 : 0;
    } else if (munCode) {
      const a = this.mun.get(`${uf}:${munCode}`);
      if (!a) return null;
      c = this.counts(a, t, delta);
    } else {
      const a = this.ufs.get(uf);
      if (!a) return null;
      c = this.counts(a, t, delta);
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
