// Backtest da projeção por cidade nas noites REAIS (ordem de chegada por zona, dados abertos do TSE).
// Refaz a noite minuto a minuto como o poller a veria: andamento de todas as cidades, votos só das que mudaram
// (até 750 por minuto, maiores primeiro), totais exatos do Brasil e de cada UF. Roda o mesmo código de produção
// (`projectByCity` + `updateLearn`) e compara com o modelo antigo (`project`) e com o parcial.
//
// Pré-requisito: npx tsx scripts/backtest-data.ts (gera raw/backtest/y<ano>.json)
// Uso: npx tsx scripts/backtest-projection.ts [--quick] [--calib] [--case 2022-T2] [--param sigmaSys=0.04 …]
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildProjModel,
  CAPITALS,
  centroidsOf,
  emptyLearn,
  expectedRemaining,
  project,
  projectByCity,
  PROJ_PARAMS,
  UF_REGION,
  updateLearn,
  type CandidateDef,
  type HistRow,
  type ProjAreaInput,
  type ProjObs,
  type ProjParams,
  type ProjSides,
  type Snap,
} from '@apuracao/shared';
import { GEO, readJson } from './lib';
import { loadBtYear, type BtYear, type BtZone } from './backtest-data';

// ------------------------------------------------------------------ dados

const emptyRow = (): HistRow => ({ el: 0, turnout: 0, abst: 0, valid: 0, blank: 0, nulls: 0, votes: {} });

function cityRows(y: BtYear | null, t: '1' | '2'): Record<string, HistRow & { uf: string }> {
  const out: Record<string, HistRow & { uf: string }> = {};
  for (const z of y?.zones[t] ?? []) {
    const r = (out[z.id] ??= { ...emptyRow(), uf: z.uf });
    r.el += z.el;
    r.turnout += z.turnout;
    r.abst += z.el - z.turnout;
    r.valid += z.valid;
    r.blank += z.blank;
    r.nulls += z.nulls;
    for (const [n, v] of Object.entries(z.votes)) r.votes[n] = (r.votes[n] ?? 0) + v;
  }
  return out;
}

let centers: Record<string, { lat: number; lon: number }> | null = null;
function centroids() {
  if (centers) return centers;
  centers = {};
  for (const f of readdirSync(join(GEO, 'mun'))) Object.assign(centers, centroidsOf(readJson(join(GEO, 'mun', f))));
  return centers;
}

interface Case {
  name: string;
  target: [number, '1' | '2'];
  base: [number, '1' | '2'];
  prev?: [number, '1' | '2'];
  prevT1?: [number, '1' | '2'];
  sides: ProjSides;
}

const CASES: Case[] = [
  // igual a domingo: 2º turno a partir do 1º turno da mesma eleição + o 2º turno anterior
  { name: '2022-T2', target: [2022, '2'], base: [2022, '1'], prev: [2018, '2'], prevT1: [2018, '1'], sides: { a: '13', b: '22', prevA: '13', prevB: '17' } },
  { name: '2018-T2', target: [2018, '2'], base: [2018, '1'], prev: [2014, '2'], prevT1: [2014, '1'], sides: { a: '13', b: '17', prevA: '13', prevB: '45' } },
  // noites de 1º turno (A×B entre os dois primeiros) a partir do 2º turno anterior: outra estrutura, mesma infraestrutura
  { name: '2022-T1', target: [2022, '1'], base: [2018, '2'], prev: [2014, '2'], prevT1: [2014, '1'], sides: { a: '13', b: '22', baseA: '13', baseB: '17', prevA: '13', prevB: '45' } },
  { name: '2026-T1', target: [2026, '1'], base: [2022, '2'], prev: [2018, '2'], prevT1: [2018, '1'], sides: { a: '13', b: '22', prevA: '13', prevB: '17' } },
];

// ------------------------------------------------------------------ cenários de ordem de chegada

interface Scenario {
  name: string;
  /** início da zona como fração da hora em que ela fecha */
  start: number;
  /** dp (logit) do desvio das primeiras seções de cada zona em relação ao total dela, e um desvio comum a todas */
  drift?: number;
  driftMean?: number;
  /** muda a hora de fechamento de uma zona */
  shift?: (z: BtZone, rnd: () => number) => number;
}

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
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

const NE_N = (z: BtZone) => UF_REGION[z.uf] === 'NE' || UF_REGION[z.uf] === 'N';
const SCENARIOS: Scenario[] = [
  { name: 'real', start: 0.3 },
  { name: 'real-tarde', start: 0.6 },
  { name: 'ruido', start: 0.3, shift: (z, r) => z.at! * Math.exp(0.25 * gauss(r)) },
  // +10 min no Nordeste e Norte reproduz a curva real de 2022 (Lula 3,3 pontos abaixo do final com 20%,
  // 1,9 com 40%, 0,9 na virada com 67,76%): a hora de fechamento das zonas sozinha não mostra isso
  { name: 'estilo-2022', start: 0.3, shift: (z) => z.at! + (NE_N(z) ? 10 : 0) },
  // estresse: bem mais extremos que qualquer noite real conhecida
  { name: 'NE+N-atrasam', start: 0.3, shift: (z) => z.at! + (NE_N(z) ? 40 : 0) },
  { name: 'SE-atrasa', start: 0.3, shift: (z) => z.at! + (UF_REGION[z.uf] === 'SE' ? 40 : 0) },
  { name: 'capitais-atrasam', start: 0.3, shift: (z) => z.at! + (CAPITALS.has(z.id) ? 60 : 0) },
  { name: 'Sul-adianta', start: 0.3, shift: (z) => Math.max(5, z.at! - (UF_REGION[z.uf] === 'S' ? 30 : 0)) },
  // as primeiras seções de cada zona fogem do total dela (centro antes da periferia, ou o contrário)
  { name: 'deriva', start: 0.3, drift: 0.25 },
  { name: 'deriva+2022', start: 0.3, drift: 0.25, shift: (z) => z.at! + (NE_N(z) ? 10 : 0) },
  // estresse: as primeiras seções de TODA zona puxam para o mesmo lado (A, depois B)
  { name: 'deriva-comum-A', start: 0.3, drift: 0.15, driftMean: 0.2 },
  { name: 'deriva-comum-B', start: 0.3, drift: 0.15, driftMean: -0.2, shift: (z) => z.at! + (NE_N(z) ? 10 : 0) },
];

// ------------------------------------------------------------------ simulação de uma noite

interface Point {
  case: string;
  scen: string;
  pst: number;
  truth: number;
  pa: number;
  sd: number;
  lo: number;
  hi: number;
  old: number | null;
  oldLo: number | null;
  oldHi: number | null;
  naive: number;
  ufErr: number[];
  ufZ: number[];
}

const CHECKPOINTS = [2, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 95, 98];

function runNight(c: Case, sc: Scenario, params: ProjParams, verbose = false): Point[] {
  const y = (yr: number) => loadBtYear(yr);
  const tgt = y(c.target[0])!;
  const base = cityRows(y(c.base[0]), c.base[1]);
  const prev = c.prev ? cityRows(y(c.prev[0]), c.prev[1]) : {};
  const prevT1 = c.prevT1 ? cityRows(y(c.prevT1[0]), c.prevT1[1]) : {};
  const geo = centroids();
  const A = c.sides.a;
  const B = c.sides.b;

  // zonas da noite-alvo, com a hora (do cenário)
  const r = rng(12345);
  const zones = tgt.zones[c.target[1]].filter((z) => z.el > 0);
  const maxAt = Math.max(...zones.map((z) => z.at ?? 0));
  const zs = zones.map((z) => {
    const at0 = z.at ?? maxAt;
    const at = Math.max(2, sc.shift ? sc.shift({ ...z, at: at0 }, r) : at0);
    return { ...z, at, st: at * sc.start, a: z.votes[A] ?? 0, b: z.votes[B] ?? 0, bias: sc.drift ? (sc.driftMean ?? 0) + sc.drift * gauss(r) : 0 };
  });

  // áreas (cidades) e modelo
  const cityIds = [...new Set(zs.map((z) => z.id))];
  const ufOf = new Map(zs.map((z) => [z.id, z.uf]));
  const elOf = new Map<string, number>();
  for (const z of zs) elOf.set(z.id, (elOf.get(z.id) ?? 0) + z.el);
  const ufBase: Record<string, HistRow> = {};
  for (const [, row] of Object.entries(base)) {
    const u = (ufBase[row.uf] ??= emptyRow());
    u.el += row.el;
    u.turnout += row.turnout;
    u.valid += row.valid;
    u.blank += row.blank;
    u.nulls += row.nulls;
    for (const [n, v] of Object.entries(row.votes)) u.votes[n] = (u.votes[n] ?? 0) + v;
  }
  const inputs: ProjAreaInput[] = cityIds.map((id) => ({
    id,
    uf: ufOf.get(id)!,
    el: elOf.get(id)!,
    base: base[id] ?? null,
    prev: prev[id] ?? null,
    prevT1: prevT1[id] ?? null,
    lat: geo[id]?.lat,
    lon: geo[id]?.lon,
    capital: CAPITALS.has(id),
  }));
  const model = buildProjModel(inputs, c.sides, ufBase, params);
  const zonesOf = new Map<number, typeof zs>();
  const outside: typeof zs = [];
  for (const z of zs) {
    const i = model.index.get(z.id);
    if (i === undefined) outside.push(z);
    else (zonesOf.get(i) ?? zonesOf.set(i, []).get(i)!).push(z);
  }

  const truthA = zs.reduce((s, z) => s + z.a, 0);
  const truthB = zs.reduce((s, z) => s + z.b, 0);
  const truth = (truthA / (truthA + truthB)) * 100;
  const ufTruth: Record<string, number> = {};
  {
    const ta: Record<string, number> = {};
    const tb: Record<string, number> = {};
    for (const z of zs) {
      ta[z.uf] = (ta[z.uf] ?? 0) + z.a;
      tb[z.uf] = (tb[z.uf] ?? 0) + z.b;
    }
    for (const u of Object.keys(ta)) ufTruth[u] = (ta[u] / (ta[u] + tb[u])) * 100;
  }
  // modelo antigo: precisa do 1º turno por UF com A e B nos números desta noite
  const cands = [{ n: 'A' }, { n: 'B' }] as unknown as CandidateDef[];
  const baseA = c.sides.baseA ?? A;
  const baseB = c.sides.baseB ?? B;
  const hist1: Record<string, HistRow> = Object.fromEntries(
    Object.entries(ufBase).map(([u, h]) => [u, { ...h, votes: { A: h.votes[baseA] ?? 0, B: h.votes[baseB] ?? 0 } }]),
  );

  const frac = (z: (typeof zs)[number], t: number) => Math.min(1, Math.max(0, (t - z.st) / Math.max(0.5, z.at - z.st)));
  /** A e B na parte apurada (fração f) de uma zona */
  const counted = (z: (typeof zs)[number], f: number) => {
    const v = (z.a + z.b) * f;
    if (!z.bias || !v) return { a: z.a * f, b: z.b * f };
    const q = (z.a + 0.5) / (z.a + z.b + 1);
    const pa = 1 / (1 + Math.exp(-(Math.log(q / (1 - q)) + z.bias * (1 - f))));
    return { a: v * pa, b: v * (1 - pa) };
  };
  const snaps = new Map<number, ProjObs['snap']>();
  const lastElc = new Map<number, number>();
  const learn = emptyLearn();
  const points: Point[] = [];
  let ck = 0;
  const end = Math.max(...zs.map((z) => z.at)) + 1;
  for (let t = 1; t <= end && ck < CHECKPOINTS.length; t += 1) {
    // andamento de todas as cidades + totais exatos
    const obs: (ProjObs | null)[] = new Array(model.areas.length).fill(null);
    const cur: { a: number; b: number; turnout: number; elc: number }[] = new Array(model.areas.length);
    const br = { a: 0, b: 0, el: 0, elc: 0, turnout: 0 };
    const ufs: Record<string, { a: number; b: number; el: number; elc: number; turnout: number }> = {};
    const add = (u: string, z: (typeof zs)[number], f: number) => {
      const x = (ufs[u] ??= { a: 0, b: 0, el: 0, elc: 0, turnout: 0 });
      const c2 = counted(z, f);
      for (const o of [x, br]) {
        o.a += c2.a;
        o.b += c2.b;
        o.el += z.el;
        o.elc += z.el * f;
        o.turnout += z.turnout * f;
      }
    };
    for (const [i, list] of zonesOf) {
      const s = { a: 0, b: 0, turnout: 0, elc: 0 };
      for (const z of list) {
        const f = frac(z, t);
        const c2 = counted(z, f);
        s.a += c2.a;
        s.b += c2.b;
        s.turnout += z.turnout * f;
        s.elc += z.el * f;
        add(z.uf, z, f);
      }
      cur[i] = s;
      obs[i] = { elc: s.elc, turnout: s.turnout, snap: snaps.get(i) ?? null };
    }
    for (const z of outside) add(z.uf, z, frac(z, t));
    // poller: busca os votos das cidades que mudaram, maiores primeiro, até 750 por minuto
    const changed = [...zonesOf.keys()].filter((i) => cur[i].elc > (lastElc.get(i) ?? 0) + 1e-9).sort((x, y2) => model.areas[y2].el - model.areas[x].el);
    for (const i of changed.slice(0, 750)) {
      snaps.set(i, { ...cur[i] });
      lastElc.set(i, cur[i].elc);
      obs[i]!.snap = snaps.get(i)!;
    }
    const pst = (br.elc / br.el) * 100;
    const res = projectByCity(model, { br, ufs, obs, pst, learn }, params);
    updateLearn(learn, model, obs, res);
    if (pst >= CHECKPOINTS[ck]) {
      while (ck < CHECKPOINTS.length && pst >= CHECKPOINTS[ck]) ck++;
      if (!res) continue;
      // modelo antigo (por UF)
      const toS = (x: { a: number; b: number; el: number; elc: number; turnout: number }, h?: HistRow): Snap => {
        const valid = x.a + x.b;
        return {
          s: '', at: '', pst: (x.elc / x.el) * 100, a: x.a, b: x.b, pa: valid ? (x.a / valid) * 100 : 0, pb: 0, valid, blank: 0, nulls: 0,
          el: x.el, elc: x.elc, turnout: x.turnout, status: 'apurando', lead: null, need: null,
          rem: expectedRemaining(x.el, x.elc, x.turnout, valid, h ? { turnout: h.turnout / h.el, valid: (h.votes.A + h.votes.B) / h.turnout } : undefined),
          rmax: x.el - x.elc,
        };
      };
      const ufSnaps = Object.fromEntries(Object.entries(ufs).map(([u, x]) => [`uf:${u}`, toS(x, hist1[u])]));
      const brSnap = toS(br);
      brSnap.rem = Object.values(ufSnaps).reduce((s, x) => s + x.rem, 0);
      const old = project({ ...brSnap, pst: Math.max(brSnap.pst, 20) }, ufSnaps, hist1, cands);
      const ufErr: number[] = [];
      const ufZ: number[] = [];
      for (const [u, e] of Object.entries(res.ufs)) {
        if (e.pst >= 100 || ufTruth[u] === undefined || u === 'ZZ') continue;
        ufErr.push(e.pa - ufTruth[u]);
        ufZ.push((e.pa - ufTruth[u]) / Math.max(1e-6, e.sd));
      }
      points.push({
        case: c.name,
        scen: sc.name,
        pst,
        truth,
        pa: res.pa,
        sd: res.sd,
        lo: res.lo,
        hi: res.hi,
        old: old?.pa ?? null,
        oldLo: old?.lo ?? null,
        oldHi: old?.hi ?? null,
        naive: brSnap.pa,
        ufErr,
        ufZ,
      });
      if (verbose) {
        const d = res.diag;
        console.log(
          `  ${pst.toFixed(1).padStart(5)}%  proj ${res.pa.toFixed(2)} [${res.lo.toFixed(2)}, ${res.hi.toFixed(2)}] erro ${(res.pa - truth).toFixed(2).padStart(6)}` +
            `  antigo ${old ? (old.pa - truth).toFixed(2).padStart(6) : '   —  '}  parcial ${(brSnap.pa - truth).toFixed(2).padStart(6)}` +
            `  | σc ${d.sigmaCity} τuf ${d.tauUf} ρ ${d.rho} σw ${d.sigmaDrift} dm ${d.driftMean}(${d.nDrift}) viés ${d.bias} zRms ${d.zRms}(${d.nErr}) sys ${d.sigmaSys}`,
        );
      }
    }
  }
  return points;
}

// ------------------------------------------------------------------ relatório

const buckets: [number, number][] = [
  [0, 7],
  [7, 17],
  [17, 35],
  [35, 65],
  [65, 85],
  [85, 101],
];

function report(points: Point[], label: string) {
  console.log(`\n=== ${label}: ${points.length} pontos`);
  console.log('  % apurado  | n   | MAE novo  antigo  parcial | cobertura 95% novo  antigo | largura novo | z rms  |z| máx | UF: MAE  cobertura');
  for (const [lo, hi] of buckets) {
    const ps = points.filter((p) => p.pst >= lo && p.pst < hi);
    if (!ps.length) continue;
    const mae = (f: (p: Point) => number | null) => {
      const v = ps.map(f).filter((x): x is number => x !== null);
      return v.length ? v.reduce((s, x) => s + Math.abs(x), 0) / v.length : NaN;
    };
    const cov = ps.filter((p) => p.truth >= p.lo && p.truth <= p.hi).length / ps.length;
    const olds = ps.filter((p) => p.oldLo !== null);
    const covOld = olds.length ? olds.filter((p) => p.truth >= p.oldLo! && p.truth <= p.oldHi!).length / olds.length : NaN;
    const z = ps.map((p) => (p.pa - p.truth) / p.sd);
    const zr = Math.sqrt(z.reduce((s, x) => s + x * x, 0) / z.length);
    const zm = Math.max(...z.map(Math.abs));
    const ue = ps.flatMap((p) => p.ufErr);
    const uz = ps.flatMap((p) => p.ufZ);
    const ucov = uz.length ? uz.filter((x) => Math.abs(x) <= 1.96).length / uz.length : NaN;
    console.log(
      `  ${String(lo).padStart(3)}–${String(hi).padEnd(4)}   | ${String(ps.length).padStart(3)} | ${mae((p) => p.pa - p.truth).toFixed(2).padStart(6)}  ${mae((p) => (p.old === null ? null : p.old - p.truth)).toFixed(2).padStart(6)}  ${mae((p) => p.naive - p.truth).toFixed(2).padStart(6)}  |` +
        `        ${(cov * 100).toFixed(0).padStart(3)}%   ${(covOld * 100).toFixed(0).padStart(4)}% |     ±${mae((p) => (p.hi - p.lo) / 2).toFixed(2)} | ${zr.toFixed(2).padStart(5)}  ${zm.toFixed(2).padStart(5)} |` +
        `     ${(ue.reduce((s, x) => s + Math.abs(x), 0) / Math.max(1, ue.length)).toFixed(2)}  ${(ucov * 100).toFixed(0)}%`,
    );
  }
  // chamada errada: a faixa exclui 50% e o lado está errado
  const wrong = points.filter((p) => (p.lo > 50 && p.truth < 50) || (p.hi < 50 && p.truth > 50));
  const wrongOld = points.filter((p) => p.oldLo !== null && ((p.oldLo > 50 && p.truth < 50) || (p.oldHi! < 50 && p.truth > 50)));
  console.log(`  vencedor errado com a faixa fora de 50%: novo ${wrong.length}, antigo ${wrongOld.length}`);
}

/** fator para a faixa de 95% cobrir de verdade: quantil 95% de |z| / 1,96, por faixa de % apurado */
function calibration(points: Point[]) {
  const out: [number, number][] = [];
  for (const [lo, hi] of buckets) {
    const z = points
      .filter((p) => p.pst >= lo && p.pst < hi)
      .map((p) => Math.abs(p.pa - p.truth) / p.sd)
      .sort((x, y) => x - y);
    if (z.length < 5) continue;
    const q = z[Math.min(z.length - 1, Math.floor(0.95 * z.length))];
    out.push([(lo + Math.min(hi, 100)) / 2, Math.round((q / 1.96) * 100) / 100]);
  }
  return out;
}

// ------------------------------------------------------------------ main

const args = process.argv.slice(2);
const params: ProjParams = { ...PROJ_PARAMS };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--param') {
    const [k, v] = args[++i].split('=');
    (params as unknown as Record<string, unknown>)[k] = k === 'calib' ? JSON.parse(v) : Number(v);
  }
}
if (args.includes('--nocalib')) params.calib = [[0, 1]];
const only = args.includes('--case') ? args[args.indexOf('--case') + 1] : null;
const quick = args.includes('--quick');
const verbose = args.includes('--verbose');
const cases = CASES.filter((c) => !only || c.name === only).filter((c) => [c.target, c.base, c.prev].every((x) => !x || loadBtYear(x[0])));
const scenArg = args.includes('--scen') ? args[args.indexOf('--scen') + 1].split(',') : null;
const scens = scenArg ? SCENARIOS.filter((s) => scenArg.includes(s.name)) : quick ? SCENARIOS.slice(0, 1) : SCENARIOS;

const all: Point[] = [];
const t0 = Date.now();
for (const c of cases) {
  const pts: Point[] = [];
  for (const sc of scens) {
    if (verbose) console.log(`\n${c.name} / ${sc.name}`);
    pts.push(...runNight(c, sc, params, verbose));
  }
  report(pts, c.name);
  all.push(...pts);
}
report(all, `TODOS (${cases.length} noites × ${scens.length} cenários)`);
if (args.includes('--calib')) console.log(`\nquantil 95% de |z| ÷ 1,96 por faixa (rodar com --nocalib): ${JSON.stringify(calibration(all))}`);
console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)}s`);
