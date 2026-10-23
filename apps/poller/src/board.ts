// Montagem pura do estado do placar a partir dos JSONs já parseados (testável sem rede).
import {
  detectMoments,
  histLead,
  project,
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

  return { state: { br, ufs, mun, curve, moments }, changed, moments: fresh };
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
    projection: o.flags.projection ? project(st.br, st.ufs, o.hist.t1?.uf, o.cands) : null,
    curve: st.curve,
    moments: st.moments.slice(-50).reverse(),
  };
}
