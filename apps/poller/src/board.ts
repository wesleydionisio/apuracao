// Montagem pura do estado do placar a partir dos JSONs já parseados (testável sem rede).
import {
  detectMoments,
  emptyLearn,
  histLead,
  project,
  projectByCity,
  updateLearn,
  ratesFromHistory,
  remainingRows,
  toSnap,
  withRemaining,
  type Board,
  type CandidateDef,
  type CurvePoint,
  type Flags,
  type Moment,
  type ParsedResult,
  type ProjDiag,
  type ProjEstimate,
  type ProjLearn,
  type ProjModel,
  type ProjObs,
  type Projection,
  type ProjectionPoint,
  type Side,
  type Snap,
} from '@apuracao/shared';
import type { History } from './history';

export interface PollState {
  br: Snap | null;
  ufs: Record<string, Snap>;
  /** chave `mun:<ibge>` */
  mun: Record<string, Snap>;
  curve: CurvePoint[];
  moments: Moment[];
  proj?: ProjState;
}

/** estado da projeção que atravessa ciclos (e reinícios, pelo arquivo de estado) */
export interface ProjState {
  /** projeção pública do último ciclo (null = escondida: pouco apurado, totalizado ou sem dado;
   *  undefined = a projeção falhou neste ciclo e o placar usa o modelo por UF) */
  last: Projection | null | undefined;
  /** histerese do "à frente": lado que a faixa excluiu e há quantos ciclos seguidos */
  streak: { side: Side | null; n: number };
  curve: ProjectionPoint[];
  learn: ProjLearn;
}

export const emptyState = (): PollState => ({ br: null, ufs: {}, mun: {}, curve: [], moments: [] });

export interface CycleInput {
  cands: CandidateDef[];
  br: ParsedResult;
  ufs: ParsedResult[];
  mun: { ibge: string; p: ParsedResult }[];
  hist: History;
  y2022Map: Record<Side, string>;
  bigMunEl: number;
  now?: string;
}

export interface CycleOutput {
  state: PollState;
  changed: Snap[];
  moments: Moment[];
}

const MAX_CURVE = 1000;
const MAX_MOMENTS = 200;

/** igualdade "de conteúdo" para decidir se um escopo mudou */
const same = (x: Snap | undefined | null, y: Snap) =>
  !!x && x.at === y.at && x.pst === y.pst && x.a === y.a && x.b === y.b && x.status === y.status;

export function runCycle(prev: PollState, i: CycleInput): CycleOutput {
  const t1uf = i.hist.t1?.uf;
  const ufs: Record<string, Snap> = {};
  for (const p of i.ufs) {
    ufs[`uf:${p.code}`] = toSnap(p, i.cands, { fallback: ratesFromHistory(t1uf?.[p.code]) });
  }
  // BR: o restante esperado é a soma por UF (pondera comparecimento de cada estado)
  let br = toSnap(i.br, i.cands, { fallback: ratesFromHistory(i.hist.t1?.br) });
  const ufList = Object.values(ufs);
  if (ufList.length >= 27) br = withRemaining(br, ufList.reduce((s, u) => s + u.rem, 0));

  const mun: Record<string, Snap> = { ...prev.mun };
  const munNew: Record<string, Snap> = {};
  for (const { ibge, p } of i.mun) {
    const key = `mun:${ibge}`;
    const s = toSnap(p, i.cands, { key, fallback: ratesFromHistory(i.hist.t1Mun[ibge]) });
    mun[key] = s;
    munNew[key] = s;
  }

  const changed: Snap[] = [];
  if (!same(prev.br, br)) changed.push(br);
  for (const [k, s] of Object.entries(ufs)) if (!same(prev.ufs[k], s)) changed.push(s);
  for (const [k, s] of Object.entries(munNew)) if (!same(prev.mun[k], s)) changed.push(s);

  const curve = [...prev.curve];
  const last = curve[curve.length - 1];
  if (br.valid > 0 && (!last || br.pst > last.pst)) {
    curve.push({ pst: br.pst, pa: br.pa, at: br.at });
    if (curve.length > MAX_CURVE) curve.splice(1, curve.length - MAX_CURVE);
  }

  const munInfo: Record<string, { name: string; uf: string; el: number }> = {};
  const lead2022: Record<string, Side | null> = {};
  for (const key of Object.keys(munNew)) {
    const ibge = key.slice(4);
    const m = i.hist.byIbge.get(ibge);
    if (m) munInfo[ibge] = { name: m.name, uf: m.uf, el: m.el };
    lead2022[ibge] = histLead(i.hist.y22t2Mun[ibge], i.y2022Map);
  }
  const seen = new Set(prev.moments.map((m) => m.id));
  // sem estado anterior (primeiro ciclo / reinício sem estado salvo) só semeia: não dispara marcos atrasados
  const detected = !prev.br ? [] : detectMoments({
    cands: i.cands,
    prevBr: prev.br,
    br,
    prevUfs: prev.ufs,
    ufs,
    prevMun: prev.mun,
    mun: munNew,
    munInfo,
    lead2022,
    bigMunEl: i.bigMunEl,
    now: i.now,
  });
  const fresh = detected.filter((m) => !seen.has(m.id));
  const moments = [...prev.moments, ...fresh].slice(-MAX_MOMENTS);

  return { state: { br, ufs, mun, curve, moments, proj: prev.proj }, changed, moments: fresh };
}

/** a partir daqui (% apurado) a projeção some: a faixa já não é faixa */
const END_PST = 99.8;
/** ciclos seguidos com a faixa inteira de um lado antes de mostrar "à frente" */
const LEAD_CYCLES = 2;
const MAX_PROJ_CURVE = 240;

export interface ProjStepInput {
  model: ProjModel | null;
  /** andamento por cidade (arquivo -ab de cada UF), chave = IBGE */
  prog: Map<string, { te?: number; elc: number; turnout: number }>;
  cands: CandidateDef[];
  hist: History;
  minPst: number;
}

export interface ProjStepOutput {
  proj: ProjState;
  /** para o painel interno (var/projection.json): os dois modelos lado a lado e o diagnóstico */
  report: {
    pst: number;
    used: 'cidade' | 'uf' | null;
    city: (ProjEstimate & { ufs: Record<string, ProjEstimate & { pst: number }> }) | null;
    uf: Projection | null;
    reason: string | null;
    diag: ProjDiag | null;
    abCoverage: number | null;
    /** eleitorado apurado: soma das cidades vs arquivo BR */
    sums: Record<string, number> | null;
  } | null;
}

/**
 * Roda a projeção por cidade (com o modelo por UF como reserva e comparação) e atualiza o aprendizado da noite.
 * Pura: o chamador guarda `proj` no estado e grava o `report`.
 */
export function projectionStep(st: PollState, i: ProjStepInput): ProjStepOutput {
  const prev = st.proj ?? { last: null, streak: { side: null, n: 0 }, curve: [], learn: emptyLearn() };
  const br = st.br;
  if (!br || br.valid <= 0) return { proj: { ...prev, last: null }, report: null };
  const old = project(br, st.ufs, i.hist.t1?.uf, i.cands, { minPst: 0 });

  let city: ReturnType<typeof projectByCity> = null;
  let reason: string | null = null;
  let abCoverage: number | null = null;
  let sums: Record<string, number> | null = null;
  if (i.model) {
    const obs: (ProjObs | null)[] = i.model.areas.map((a) => {
      const p = i.prog.get(a.id);
      const s = st.mun[`mun:${a.id}`];
      if (!p && !s) return null;
      return {
        el: p?.te || s?.el || undefined,
        elc: Math.max(p?.elc ?? 0, s?.elc ?? 0),
        turnout: Math.max(p?.turnout ?? 0, s?.turnout ?? 0),
        snap: s ? { a: s.a, b: s.b, turnout: s.turnout, elc: s.elc } : null,
      };
    });
    const elcAb = obs.reduce((acc, o) => acc + (o?.elc ?? 0), 0);
    abCoverage = br.elc > 0 ? elcAb / br.elc : null;
    sums = { ab: Math.round(elcAb), br: br.elc, prog: [...i.prog.values()].reduce((x, p) => x + p.elc, 0) };
    const ufs: Record<string, { a: number; b: number; el: number; elc: number }> = {};
    for (const [k, s] of Object.entries(st.ufs)) ufs[k.slice(3)] = { a: s.a, b: s.b, el: s.el, elc: s.elc };
    try {
      city = projectByCity(i.model, { br: { a: br.a, b: br.b, el: br.el, elc: br.elc }, ufs, obs, pst: br.pst, learn: prev.learn });
      updateLearn(prev.learn, i.model, obs, city);
    } catch (e) {
      reason = `erro: ${(e as Error).message}`;
      city = null;
    }
    // salvaguardas: andamento por cidade faltando ou incoerente com os arquivos das UFs → modelo por UF
    if (city && !reason) {
      if (abCoverage !== null && br.pst >= 5 && (abCoverage < 0.85 || abCoverage > 1.15)) reason = `andamento por cidade cobre ${Math.round(abCoverage * 100)}% do apurado`;
      else if (city.diag.remScaleMax < 0.5 || city.diag.remScaleMax > 2) reason = `resto por cidade ×${city.diag.remScaleMax} do arquivo da UF`;
      else if (![city.pa, city.lo, city.hi, city.sd].every(Number.isFinite) || city.sd <= 0) reason = 'número inválido';
    }
  } else reason = 'sem histórico por cidade';

  const pst = br.pst;
  // no fim (quase nada a apurar, 100% ou totalizado) a faixa vira um ponto: some, e não há "reserva" a explicar
  const ending = pst >= END_PST || br.status === 'totalizado';
  if (ending) reason = null;
  const useCity = !!city && !reason;
  let last: Projection | null = null;
  if (pst >= i.minPst && !ending) {
    if (useCity) {
      const ufs: Projection['ufs'] = {};
      for (const [uf, e] of Object.entries(city!.ufs)) {
        const s = st.ufs[`uf:${uf}`];
        if (s && s.pst >= i.minPst && s.status !== 'totalizado' && s.pst < END_PST && e.hi - e.lo >= 0.05) ufs[uf] = { pa: e.pa, lo: e.lo, hi: e.hi };
      }
      last = { pa: city!.pa, lo: city!.lo, hi: city!.hi, basedOnPst: pst, model: 'cidade', ufs };
    } else if (old) last = { ...old, model: 'uf' };
  }
  // histerese: "à frente" só depois de LEAD_CYCLES ciclos seguidos com a faixa inteira do mesmo lado; some na hora
  const side: Side | null = last ? (last.lo > 50 ? 'a' : last.hi < 50 ? 'b' : null) : null;
  const streak = side && side === prev.streak.side ? { side, n: prev.streak.n + 1 } : { side, n: side ? 1 : 0 };
  if (last) last.lead = side && streak.n >= LEAD_CYCLES ? side : null;
  const curve = [...prev.curve];
  if (last && (!curve.length || pst >= curve[curve.length - 1].pst + 0.5)) {
    curve.push({ pst: Math.round(pst * 100) / 100, pa: last.pa, lo: last.lo, hi: last.hi });
    if (curve.length > MAX_PROJ_CURVE) curve.splice(0, curve.length - MAX_PROJ_CURVE);
  }
  if (last) last.curve = curve;
  return {
    proj: { last, streak, curve, learn: prev.learn },
    report: {
      pst,
      used: last ? (last.model ?? null) : null,
      city: city ? { pa: city.pa, lo: city.lo, hi: city.hi, sd: city.sd, pWin: city.pWin, ufs: city.ufs } : null,
      uf: old,
      reason,
      diag: city?.diag ?? null,
      abCoverage,
      sums,
    },
  };
}

/** modelo por UF quando a projeção por cidade não rodou (sem estado de projeção ou falha no ciclo) */
function fallbackProjection(st: PollState, hist: History, cands: CandidateDef[]): Projection | null {
  if (!st.br || st.br.pst >= END_PST) return null;
  const p = project(st.br, st.ufs, hist.t1?.uf, cands);
  return p ? { ...p, model: 'uf' } : null;
}

export function toBoard(
  st: PollState,
  o: {
    cands: CandidateDef[];
    y2022Map: Record<Side, string>;
    flags: Flags;
    hist: History;
    released: boolean;
    releaseAt: Date;
    sourceUrl: string;
    now?: Date;
  },
): Board {
  const base: Board = {
    v: 1,
    generatedAt: (o.now ?? new Date()).toISOString(),
    released: o.released,
    releaseAt: o.releaseAt.toISOString(),
    source: { name: 'TSE', url: o.sourceUrl, at: st.br?.at ?? null },
    candidates: o.cands,
    y2022Map: o.y2022Map,
    flags: o.flags,
    br: null,
    ufs: {},
    remaining: [],
    projection: null,
    curve: [],
    moments: [],
  };
  // antes das 17h: nada de placar nem projeção, nem mesmo zerado
  if (!o.released || !st.br) return base;
  return {
    ...base,
    br: st.br,
    ufs: st.ufs,
    remaining: remainingRows(st.ufs, o.hist.t1?.uf, o.cands),
    projection: !o.flags.projection ? null : st.proj && st.proj.last !== undefined ? st.proj.last : fallbackProjection(st, o.hist, o.cands),
    curve: st.curve,
    moments: st.moments.slice(-50).reverse(),
  };
}
