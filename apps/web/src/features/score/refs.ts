// Referências que o usuário liga/desliga no placar: 1º turno 2026 e 2º turno 2022.
// Estado em localStorage 'refs' = {"t1":bool,"y22":bool}; sincronizado entre componentes e abas.
import type { Board, HistRow } from '@apuracao/shared';
import { twoWay } from '@apuracao/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { staticData } from '@/lib/api';

export interface Refs {
  t1: boolean;
  y22: boolean;
}

const KEY = 'refs';
const EVT = 'refs-change';
const DEFAULT: Refs = { t1: false, y22: false };

let cache: Refs | null = null;
let raw: string | null = null;

function read(): Refs {
  let s: string | null = null;
  try {
    s = localStorage.getItem(KEY);
  } catch {
    /* sem storage */
  }
  if (cache && s === raw) return cache;
  raw = s;
  try {
    const p = s ? JSON.parse(s) : {};
    cache = { t1: !!p.t1, y22: !!p.y22 };
  } catch {
    cache = DEFAULT;
  }
  return cache;
}

function subscribe(cb: () => void) {
  const on = () => cb();
  window.addEventListener(EVT, on);
  window.addEventListener('storage', on);
  return () => {
    window.removeEventListener(EVT, on);
    window.removeEventListener('storage', on);
  };
}

export function setRefs(next: Partial<Refs>) {
  const v = { ...read(), ...next };
  try {
    // preserva campos que outras telas guardam na mesma chave (ex.: "chart" da tela Ao vivo)
    let cur: Record<string, unknown> = {};
    try {
      const p = JSON.parse(localStorage.getItem(KEY) ?? '{}');
      if (p && typeof p === 'object') cur = p;
    } catch {
      /* valor inválido: recomeça */
    }
    localStorage.setItem(KEY, JSON.stringify({ ...cur, ...next }));
  } catch {
    cache = v; // sem storage: vale só nesta sessão
    raw = null;
  }
  window.dispatchEvent(new Event(EVT));
}

export function useRefs(): [Refs, (next: Partial<Refs>) => void] {
  const v = useSyncExternalStore(subscribe, read, () => DEFAULT);
  return [v, setRefs];
}

/** % de A no confronto A×B de cada referência, para o Brasil e por UF */
export interface RefValues {
  t1: { br: number | null; uf: Record<string, number | null>; rows: { br: HistRow | null; uf: Record<string, HistRow> } } | null;
  y22: { br: number | null; uf: Record<string, number | null>; rows: { br: HistRow | null; uf: Record<string, HistRow> } } | null;
}

function pack(h: { br: HistRow | null; uf: Record<string, HistRow> } | null, cands: Board['candidates']) {
  if (!h) return null;
  const uf: Record<string, number | null> = {};
  for (const [k, row] of Object.entries(h.uf)) uf[k] = twoWay(row, cands);
  return { br: twoWay(h.br, cands), uf, rows: h };
}

/** carrega (com cache) as duas referências; 2022 usa os números do mapeamento y2022Map */
export function useRefValues(board: Board | null): RefValues {
  const [v, set] = useState<RefValues>({ t1: null, y22: null });
  const key = board ? `${board.candidates.map((c) => c.n).join('-')}|${board.y2022Map.a}-${board.y2022Map.b}` : '';
  useEffect(() => {
    if (!board) return;
    let alive = true;
    const [ca, cb] = board.candidates;
    // 2022: mesmos "lados", mas os números podem ser outros
    const c22 = [
      { ...ca, n: board.y2022Map.a },
      { ...cb, n: board.y2022Map.b },
    ];
    Promise.all([staticData.hist('t1-2026').catch(() => null), staticData.hist('y2022-t2').catch(() => null)]).then(([t1, y22]) => {
      if (!alive) return;
      set({ t1: pack(t1, board.candidates), y22: pack(y22, c22) });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return v;
}

/** referências ativas para um escopo ('br' ou 'uf:SP'), no formato que CandidateRows aceita */
export function activeRefs(refs: Refs, values: RefValues, scope = 'br'): { t1?: number | null; y22?: number | null } {
  const pick = (r: RefValues['t1']) => (!r ? null : scope === 'br' ? r.br : (r.uf[scope.replace(/^uf:/, '')] ?? null));
  return {
    ...(refs.t1 ? { t1: pick(values.t1) } : {}),
    ...(refs.y22 ? { y22: pick(values.y22) } : {}),
  };
}
