// Dados do mapa e da cidade: placar ao vivo por UF/município + histórico (1º turno 2026, 2022).
import type { Board, CandidateDef, HistRow, MunBoard, Municipality, Snap } from '@apuracao/shared';
import { twoWay } from '@apuracao/shared';
import { useEffect, useMemo, useState } from 'react';
import { fetchMunBoard, staticData } from '@/lib/api';

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: boolean }>({ data: null, loading: true, error: false });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fn()
      .then((data) => alive && setState({ data, loading: false, error: false }))
      .catch(() => alive && setState((s) => ({ ...s, loading: false, error: true })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export function useMedia(query: string) {
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

/** os candidatos de 2022 com os números daquele ano (para twoWay em linhas de 2022) */
export const cands2022 = (b: Board): CandidateDef[] => [
  { ...b.candidates[0], n: b.y2022Map.a },
  { ...b.candidates[1], n: b.y2022Map.b },
];

export const pa2022 = (b: Board, h: HistRow | null | undefined) => (h ? twoWay(h, cands2022(b)) : null);

export interface UfValue {
  pa: number | null;
  pst: number | null;
  snap?: Snap;
}

export type MapLayer = 'live' | 't1' | 'y2022';

/** valores por UF para o mapa: ao vivo depois das 17h; antes, o confronto A×B do 1º turno */
export function useStateValues(board: Board | null, layer?: MapLayer) {
  const live = !!board?.released && !!board.br;
  const want: MapLayer = layer ?? (live ? 'live' : 't1');
  const { data: t1 } = useAsync(() => (want === 't1' ? staticData.hist('t1-2026') : Promise.resolve(null)), [want]);
  const { data: y22 } = useAsync(() => (want === 'y2022' ? staticData.hist('y2022-t2') : Promise.resolve(null)), [want]);
  const values = useMemo(() => {
    const out: Record<string, UfValue> = {};
    if (!board) return out;
    if (want === 'live') {
      for (const [k, s] of Object.entries(board.ufs)) out[k.slice(3)] = { pa: s.valid ? s.pa : null, pst: s.pst, snap: s };
    } else if (want === 't1' && t1) {
      for (const [uf, h] of Object.entries(t1.uf)) out[uf] = { pa: twoWay(h, board.candidates), pst: null };
    } else if (want === 'y2022' && y22) {
      for (const [uf, h] of Object.entries(y22.uf)) out[uf] = { pa: pa2022(board, h), pst: null };
    }
    return out;
  }, [board, want, t1, y22]);
  return { values, layer: want, live };
}

export type RefLayer = 't1' | 'y2022';

export const REF_LABEL: Record<RefLayer, string> = { t1: '1º turno', y2022: '2022' };

/** % de A por UF no 1º turno 2026 (confronto direto) e no 2º turno de 2022 — para comparar com qualquer camada */
export function useUfRefs(board: Board | null) {
  const { data: t1 } = useAsync(() => staticData.hist('t1-2026'), []);
  const { data: y22 } = useAsync(() => staticData.hist('y2022-t2'), []);
  return useMemo(() => {
    const out: Record<RefLayer, Record<string, number | null>> = { t1: {}, y2022: {} };
    if (!board) return { refs: out, t1, y22 };
    for (const [uf, h] of Object.entries(t1?.uf ?? {})) out.t1[uf] = twoWay(h, board.candidates);
    for (const [uf, h] of Object.entries(y22?.uf ?? {})) out.y2022[uf] = pa2022(board, h);
    return { refs: out, t1, y22 };
  }, [board, t1, y22]);
}

/** deslocamento de A em pontos (agora − referência) por UF */
export function swingOf(values: Record<string, UfValue | undefined>, ref: Record<string, number | null>) {
  const out: Record<string, number | null> = {};
  for (const [uf, v] of Object.entries(values)) {
    const r = ref[uf];
    out[uf] = v?.pa != null && r != null ? v.pa - r : null;
  }
  return out;
}

/**
 * Valores "falsos" para pintar o mapa pelo deslocamento: pa' = 50 + Δ/2 faz a margem do mapa (|2pa'−100|)
 * ser exatamente |Δ| e a cor ser de quem ganhou terreno. Assim a mesma escala/legenda serve aos dois modos.
 */
export function swingValues(values: Record<string, UfValue | undefined>, ref: Record<string, number | null>): Record<string, UfValue> {
  const out: Record<string, UfValue> = {};
  for (const [uf, d] of Object.entries(swingOf(values, ref))) out[uf] = { pa: d === null ? null : 50 + d / 2, pst: values[uf]?.pst ?? null, snap: values[uf]?.snap };
  return out;
}

export interface MunRow {
  m: Municipality;
  s: Snap | null;
  y22: HistRow | null;
  t1: HistRow | null;
}

/** Municípios de uma UF (maiores primeiro), com parcial ao vivo, 1º turno e 2022. Recarrega a cada 30s ao vivo. */
export function useUfMunicipalities(uf: string, released: boolean) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!released) return;
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, [released]);
  return useAsync(async () => {
    const [list, mb, y22, t1] = await Promise.all([
      staticData.municipalities(),
      released ? fetchMunBoard(uf).catch(() => null) : Promise.resolve<MunBoard | null>(null),
      staticData.histMun('y2022-t2', uf).catch(() => null),
      staticData.histMun('t1-2026', uf).catch(() => null),
    ]);
    const rows: MunRow[] = (list ?? [])
      .filter((m) => m.uf === uf)
      .map((m) => ({ m, s: mb?.mun[m.ibge] ?? null, y22: y22?.[m.ibge] ?? null, t1: t1?.[m.ibge] ?? null }))
      .sort((a, b) => b.m.el - a.m.el);
    return { rows, hasLive: !!mb && Object.keys(mb.mun).length > 0 };
  }, [uf, released, tick]);
}

export const cityHref = (m: Pick<Municipality, 'uf' | 'slug'>) => `/cidade/${m.uf.toLowerCase()}/${m.slug}`;
