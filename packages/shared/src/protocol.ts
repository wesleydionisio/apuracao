// Protocolo WebSocket (JSON pequeno). Ver spec §9.
import type { Flags, Moment, Side, Snap } from './types';

export const MAX_BODY = 240;

/** categorias da moderação (filtro local + modelo de decisão) */
export type ModCategory = 'palavrao' | 'ofensa' | 'discriminacao' | 'ameaca' | 'sexual' | 'spam' | 'link' | 'outro';

export const MOD_LABEL: Record<ModCategory, string> = {
  palavrao: 'palavrão',
  ofensa: 'ofensa a alguém',
  discriminacao: 'discriminação',
  ameaca: 'ameaça ou violência',
  sexual: 'conteúdo sexual',
  spam: 'spam',
  link: 'link',
  outro: 'conteúdo impróprio',
};
export const HISTORY_ON_JOIN = 50;
export const EMOJI_REACTIONS = ['🔥', '😱', '👏', '😂', '👀', '🙏'] as const;
/** torcida: "manda um 13" / "manda um 22" — agregada como reação, nunca como voto */
export const CHEERS = ['cheer:a', 'cheer:b'] as const;
export const REACTIONS = [...EMOJI_REACTIONS, ...CHEERS] as const;
export type Reaction = (typeof REACTIONS)[number];
export const cheerOf = (side: Side) => `cheer:${side}` as const;

/**
 * Emoji de partido/candidato dentro do texto do chat: ":13:", ":22:", ":pt:", ":pl:".
 * O servidor trata como texto comum; o cliente desenha como selo na cor do candidato.
 */
export const PARTY_TOKEN_RE = /:([a-z]{2,12}|\d{2}):/gi;

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
  /** lado que o autor escolheu torcer (selo ao lado do apelido) */
  side?: Side;
  /** mensagem barrada pela moderação: o texto não vem, só a categoria */
  mod?: ModCategory;
  /** linha só deste aparelho (aviso de mensagem não enviada); nunca vem do servidor */
  local?: true;
}

export type ClientMsg =
  | { t: 'join'; rooms: Room[] }
  | { t: 'leave'; rooms: Room[] }
  | { t: 'chat'; r: Room; body: string }
  | { t: 'react'; r: Room; e: Reaction }
  | { t: 'nick'; nick: string }
  | { t: 'side'; side: Side | null }
  | { t: 'report'; r: Room; id: string }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'hello'; you: { id: string; nick: string; hue: number; side?: Side | null }; online: number; flags: Flags }
  | { t: 'snap'; s: string; d: Snap }
  | { t: 'history'; r: Room; m: ChatMsg[] }
  | { t: 'chat'; r: Room; m: ChatMsg }
  | { t: 'del'; r: Room; id: string }
  | { t: 'react'; r: Room; agg: Partial<Record<Reaction, number>> }
  | { t: 'moment'; m: Moment }
  | { t: 'online'; n: number }
  | { t: 'flags'; flags: Flags; closedRooms?: Room[] }
  | { t: 'slow'; r: Room; seconds: number }
  | {
      t: 'err';
      code: 'rate' | 'slow' | 'blocked' | 'closed' | 'invalid' | 'off' | 'muted';
      r?: Room;
      /** segundos até poder mandar de novo (rate, slow, muted) */
      wait?: number;
      /** por que a mensagem foi recusada (blocked) */
      cat?: ModCategory;
      /** muted: por spam ou por conteúdo impróprio */
      reason?: 'spam' | 'abuse';
      /** o bloqueio já apareceu no chat para todos (primeiro bloqueio da pessoa) */
      public?: true;
    }
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
