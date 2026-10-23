// Protocolo WebSocket (JSON pequeno). Ver spec §9.
import type { Flags, Moment, Snap } from './types';

export const MAX_BODY = 240;
export const HISTORY_ON_JOIN = 50;
export const REACTIONS = ['👀', '🔥', '😱', '👏', '😂'] as const;
export type Reaction = (typeof REACTIONS)[number];

/** salas: 'br', 'sp', 'mg', ... ou 'sala:<slug>' */
export type Room = string;

export interface ChatMsg {
  id: string;
  nick: string;
  /** cor do avatar (hue 0–359) derivada do id anônimo */
  hue: number;
  body: string;
  at: number;
  sys?: true;
}

export type ClientMsg =
  | { t: 'join'; rooms: Room[] }
  | { t: 'leave'; rooms: Room[] }
  | { t: 'chat'; r: Room; body: string }
  | { t: 'react'; r: Room; e: Reaction }
  | { t: 'nick'; nick: string }
  | { t: 'report'; r: Room; id: string }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'hello'; you: { id: string; nick: string; hue: number }; online: number; flags: Flags }
  | { t: 'snap'; s: string; d: Snap }
  | { t: 'history'; r: Room; m: ChatMsg[] }
  | { t: 'chat'; r: Room; m: ChatMsg }
  | { t: 'del'; r: Room; id: string }
  | { t: 'react'; r: Room; agg: Partial<Record<Reaction, number>> }
  | { t: 'moment'; m: Moment }
  | { t: 'online'; n: number }
  | { t: 'flags'; flags: Flags; closedRooms?: Room[] }
  | { t: 'slow'; r: Room; seconds: number }
  | { t: 'err'; code: 'rate' | 'slow' | 'blocked' | 'closed' | 'invalid' | 'off'; r?: Room; wait?: number }
  | { t: 'pong' };

const UF_ROOMS = new Set([
  'br', 'ac', 'al', 'ap', 'am', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mt', 'ms', 'mg', 'pa',
  'pb', 'pr', 'pe', 'pi', 'rj', 'rn', 'rs', 'ro', 'rr', 'sc', 'sp', 'se', 'to',
]);

export function isValidRoom(r: unknown): r is Room {
  if (typeof r !== 'string') return false;
  if (UF_ROOMS.has(r)) return true;
  return /^sala:[a-z0-9-]{3,32}$/.test(r);
}

/** escopo de snapshot correspondente a uma sala de UF ('sp' -> 'uf:SP') */
export const roomScope = (r: Room) => (r === 'br' ? 'br' : r.startsWith('sala:') ? null : `uf:${r.toUpperCase()}`);

export function hueOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

// Canais do Redis (pub/sub entre poller, workers WS e API)
export const CH = {
  snap: 'ch:snap', // payload: Snap[] (só escopos que mudaram)
  moment: 'ch:moment', // payload: Moment
  chat: 'ch:chat', // payload: { r, m }
  del: 'ch:del', // payload: { r, id }
  flags: 'ch:flags',
} as const;

export const KEY = {
  snap: (s: string) => `snap:${s}`,
  chat: (r: Room) => `chat:${r}`,
  react: (r: Room) => `react:${r}`,
  online: (worker: string) => `online:${worker}`,
  flag: (f: string) => `flag:${f}`,
  roomClosed: 'flag:rooms_closed', // SET de salas desligadas
  guesses: 'count:guesses',
} as const;
