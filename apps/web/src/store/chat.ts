import type { ChatMsg, Reaction, Room } from '@apuracao/shared';
import { create } from 'zustand';

const MAX = 200;

export interface ChatErr {
  code: string;
  wait?: number;
  /** categoria da moderação (blocked/muted) */
  cat?: string;
  /** muted: spam ou conteúdo impróprio */
  reason?: string;
  at: number;
}

interface ChatState {
  msgs: Record<Room, ChatMsg[]>;
  reacts: Record<Room, Partial<Record<Reaction, number>>>;
  slow: Record<Room, number>;
  err: Record<Room, ChatErr | undefined>;
  closed: Room[];
  enabled: boolean;
  /** Super Chats recentes por sala (a fita do topo escolhe os que ainda estão no tempo) */
  pins: Record<Room, ChatMsg[]>;
  setPins: (r: Room, m: ChatMsg[]) => void;
  /** última reação recebida por sala, para a animação */
  burst: Record<Room, { e: Reaction; n: number; k: number } | undefined>;
  history: (r: Room, m: ChatMsg[]) => void;
  push: (r: Room, m: ChatMsg) => void;
  del: (r: Room, id: string) => void;
  react: (r: Room, agg: Partial<Record<Reaction, number>>) => void;
  set: (p: Partial<ChatState>) => void;
  setErr: (r: Room, e: ChatErr | undefined) => void;
}

export const useChat = create<ChatState>((set, get) => ({
  msgs: {},
  reacts: {},
  slow: {},
  err: {},
  closed: [],
  enabled: true,
  burst: {},
  pins: {},
  setPins: (r, m) => {
    const cur = get().pins[r] ?? [];
    const ids = new Set(cur.map((x) => x.id));
    const add = m.filter((x) => x.sc && !ids.has(x.id));
    if (add.length) set({ pins: { ...get().pins, [r]: [...cur, ...add].slice(-30) } });
  },
  history: (r, m) => {
    set({ msgs: { ...get().msgs, [r]: m.slice(-MAX) } });
    get().setPins(r, m);
  },
  push: (r, m) => {
    const cur = get().msgs[r] ?? [];
    if (cur.some((x) => x.id === m.id)) return;
    const next = cur.length >= MAX ? [...cur.slice(cur.length - MAX + 1), m] : [...cur, m];
    set({ msgs: { ...get().msgs, [r]: next } });
    if (m.sc) get().setPins(r, [m]);
  },
  del: (r, id) =>
    set({
      msgs: { ...get().msgs, [r]: (get().msgs[r] ?? []).filter((m) => m.id !== id) },
      pins: { ...get().pins, [r]: (get().pins[r] ?? []).filter((m) => m.id !== id) },
    }),
  react: (r, agg) => {
    const prev = get().reacts[r] ?? {};
    let top: Reaction | null = null;
    let topDelta = 0;
    for (const [e, n] of Object.entries(agg) as [Reaction, number][]) {
      const d = n - (prev[e] ?? 0);
      if (d > topDelta) {
        topDelta = d;
        top = e;
      }
    }
    set({
      reacts: { ...get().reacts, [r]: agg },
      burst: top ? { ...get().burst, [r]: { e: top, n: topDelta, k: Date.now() } } : get().burst,
    });
  },
  set: (p) => set(p),
  setErr: (r, e) => set({ err: { ...get().err, [r]: e } }),
}));
