import type { Board, Flags, Moment, Snap } from '@apuracao/shared';
import { create } from 'zustand';
import type { Me, Stats } from '../lib/api';

export type LinkStatus = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'demo';

interface BoardState {
  board: Board | null;
  loadError: boolean;
  /** quando o placar foi buscado/atualizado por último neste aparelho */
  seenAt: number;
  link: LinkStatus;
  online: number | null;
  stats: Stats | null;
  me: Me | null;
  /** o placar grande da home está na tela (o cabeçalho então fica enxuto) */
  heroVisible: boolean;
  setBoard: (b: Board) => void;
  applySnap: (s: Snap) => void;
  addMoment: (m: Moment) => void;
  setFlags: (f: Flags) => void;
  set: (p: Partial<BoardState>) => void;
}

const newer = (cur: Snap | undefined | null, next: Snap) =>
  !cur || Date.parse(next.at) > Date.parse(cur.at) || (next.at === cur.at && next.pst >= cur.pst);

export const useBoard = create<BoardState>((set, get) => ({
  board: null,
  loadError: false,
  seenAt: 0,
  link: 'connecting',
  online: null,
  stats: null,
  me: null,
  heroVisible: false,
  setBoard: (b) => {
    const cur = get().board;
    if (cur) {
      // um snapshot recebido via WS pode ser mais novo que o JSON estático em cache na CDN
      if (cur.br && b.br && !newer(cur.br, b.br)) b = { ...b, br: cur.br };
      const ufs = { ...b.ufs };
      for (const [k, s] of Object.entries(cur.ufs)) if (ufs[k] && !newer(s, ufs[k])) ufs[k] = s;
      const ids = new Set(b.moments.map((m) => m.id));
      const extra = cur.moments.filter((m) => !ids.has(m.id));
      b = { ...b, ufs, moments: [...extra, ...b.moments].sort((x, y) => Date.parse(y.at) - Date.parse(x.at)) };
    }
    set({ board: b, loadError: false, seenAt: Date.now() });
  },
  applySnap: (s) => {
    const b = get().board;
    if (!b || !b.released) return;
    if (s.s === 'br') {
      if (!newer(b.br, s)) return;
      const curve = b.curve.length && b.curve[b.curve.length - 1].pst >= s.pst ? b.curve : [...b.curve, { pst: s.pst, pa: s.pa, at: s.at }];
      set({ board: { ...b, br: s, curve }, seenAt: Date.now() });
    } else if (s.s.startsWith('uf:')) {
      if (!newer(b.ufs[s.s], s)) return;
      set({ board: { ...b, ufs: { ...b.ufs, [s.s]: s } }, seenAt: Date.now() });
    }
  },
  addMoment: (m) => {
    const b = get().board;
    if (!b || b.moments.some((x) => x.id === m.id)) return;
    set({ board: { ...b, moments: [m, ...b.moments] } });
  },
  setFlags: (flags) => {
    const b = get().board;
    if (b) set({ board: { ...b, flags } });
  },
  set: (p) => set(p),
}));

export const candOf = (b: Board | null, side: 'a' | 'b') => b?.candidates.find((c) => c.key === side);

/** primeira palavra do nome curto; se os dois começam igual, usa o nome curto inteiro */
export function shortLabel(cands: { short: string }[], i: 0 | 1): string {
  const w = cands.map((c) => c.short.split(' ')[0]);
  return w[0] === w[1] ? cands[i].short : w[i];
}

/** inicial do candidato; se colidir, "A"/"B" */
export function initialOf(cands: { short: string }[], i: 0 | 1): string {
  const w = cands.map((c) => c.short.charAt(0).toUpperCase());
  return w[0] === w[1] ? (i ? 'B' : 'A') : w[i];
}
