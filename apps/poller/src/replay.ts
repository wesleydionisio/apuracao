// Simulador da noite de apuração: gera JSONs no MESMO formato do TSE, então o pipeline inteiro
// (parser → cálculos → momentos → JSON estático → WS) é exercitado como no domingo.
// Base: 1º turno 2026 por UF/município (ETL) ou, sem ETL, as fixtures reais do repositório.
import { readFileSync } from 'node:fs';
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
  bias: number; // viés das primeiras seções (some quando chega a 100%)
  delay: number; // 0–1 da noite
  span: number; // duração relativa da apuração
}

const DURATION_H = 3.5; // 17h → 20h30 em tempo "virtual"

export class ReplaySource implements Source {
  readonly name = 'replay';
  private t0 = Date.now();
  private ufs = new Map<string, Area>();
  private mun = new Map<string, Area & { uf: string }>();
  private cands: { n: string; name: string; seq: number }[];

  constructor(
    private cfg: Config,
    hist: History,
  ) {
    const fx = (f: string) => JSON.parse(readFileSync(path.join(cfg.repo, 'packages/data/fixtures', f), 'utf8'));
    const t2 = parseResult(fx('t2-br.json'));
    this.cands = Object.entries(t2.names)
      .map(([n, v]) => ({ n, name: v.name, seq: v.seq }))
      .sort((x, y) => x.seq - y.seq);
    const cd: CandidateDef[] = this.cands.map((c, i) => ({
      key: i === 0 ? 'a' : 'b', n: c.n, name: c.name, short: c.name, color: '',
    }));
    const r = rng(cfg.replay.seed);
    const swing = (r() - 0.5) * 3;
    // viés nacional das primeiras urnas (como 2022: um lado larga na frente e o outro vira)
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
        fa: clamp(pa1 + spread + swing + (u() - 0.5) * 3, 5, 95),
        bias: early + (u() - 0.5) * 6,
        delay: u() * 0.08,
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
      this.mun.set(`${m.uf}:${m.tse}`, {
        uf: m.uf,
        el: h.el,
        tr: h.el ? clamp(h.turnout / h.el, 0.5, 0.95) : parent.tr,
        fa: clamp(parent.fa + (pa1 - ufPa1) + (u() - 0.5) * 2, 2, 98),
        bias: parent.bias + (u() - 0.5) * 4,
        delay: clamp(parent.delay + (u() - 0.3) * 0.1, 0, 0.3),
        span: clamp(parent.span + (u() - 0.5) * 0.3, 0.2, 0.95),
      });
    }
    console.log(`[replay] ${this.ufs.size} UFs, ${this.mun.size} municípios, noite de ${cfg.replay.minutes} min`);
  }

  /** 0 → 1 ao longo da noite simulada (passa um pouco de 1 para fechar a totalização) */
  private t() {
    return (Date.now() - this.t0) / (this.cfg.replay.minutes * 60_000);
  }

  private pst(a: Area, t: number) {
    const u = clamp((t - a.delay) / a.span, 0, 1);
    return 100 * (1 - (1 - u) ** 2);
  }

  private counts(a: Area, t: number) {
    const pst = this.pst(a, t);
    const elc = Math.round((a.el * pst) / 100);
    const turnout = Math.round(elc * a.tr);
    const valid = Math.round(turnout * 0.955);
    const blank = Math.round(turnout * 0.016);
    const share = clamp(a.fa + a.bias * (1 - pst / 100), 1, 99) / 100;
    const va = Math.round(valid * share);
    return { pst, el: a.el, elc, turnout, valid, blank, nulls: turnout - valid - blank, va, vb: valid - va };
  }

  async get(p: string): Promise<unknown | null> {
    const m = /\/(\d+)\/dados\/([a-z]{2})\/([a-z]{2})(\d*)-c0001-e\d+-u\.json$/.exec(p);
    if (!m || m[1] !== this.cfg.tse.code) return null;
    const t = this.t();
    const uf = m[3].toUpperCase();
    const munCode = m[4];
    const clock = new Date(Date.parse('2026-10-25T20:00:00Z') + clamp(t, 0, 1.05) * DURATION_H * 3_600_000);
    const done = t >= 1.03;
    let c: ReturnType<ReplaySource['counts']>;
    if (m[2] === 'br') {
      c = { pst: 0, el: 0, elc: 0, turnout: 0, valid: 0, blank: 0, nulls: 0, va: 0, vb: 0 };
      for (const a of this.ufs.values()) {
        const x = this.counts(a, t);
        for (const k of Object.keys(c) as (keyof typeof c)[]) if (k !== 'pst') c[k] += x[k];
      }
      c.pst = c.el ? (c.elc / c.el) * 100 : 0;
    } else if (munCode) {
      const a = this.mun.get(`${uf}:${munCode}`);
      if (!a) return null;
      c = this.counts(a, t);
    } else {
      const a = this.ufs.get(uf);
      if (!a) return null;
      c = this.counts(a, t);
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

const s = (n: number) => String(Math.round(n));
const pc = (n: number) => n.toFixed(9).replace('.', ',');

function fakeTse(o: {
  ele: string;
  tpabr: string;
  cdabr: string;
  clock: Date;
  done: boolean;
  cands: { n: string; name: string; seq: number; vap: number }[];
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
        par: [{ cand: [{ n: c.n, nmu: c.name, nm: c.name, seq: String(c.seq), vap: s(c.vap),
          pvapn: pc(o.valid ? (c.vap / o.valid) * 100 : 0) }] }],
      })),
    }],
    s: { ts: s(ts), st: s((ts * o.pst) / 100), pstn: pc(o.pst) },
    e: { te: s(o.el), est: s(o.elc), c: s(o.turnout), a: s(o.elc - o.turnout) },
    v: { vv: s(o.valid), vb: s(o.blank), tvn: s(o.nulls) },
  };
}
