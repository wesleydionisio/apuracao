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
/** lado vindo do cliente: só 'a' ou 'b' contam; qualquer outra coisa (null, neutro, lixo) é sem lado */
export const wireSide = (v: unknown): Side | null => (v === 'a' || v === 'b' ? v : null);

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
  /** Super Chat: valor pago em centavos (a faixa decide cor e tempo fixado) */
  sc?: number;
}

export type ClientMsg =
  | { t: 'join'; rooms: Room[] }
  | { t: 'leave'; rooms: Room[] }
  | { t: 'chat'; r: Room; body: string }
  | { t: 'react'; r: Room; e: Reaction }
  | { t: 'nick'; nick: string }
  /** null = sem lado: ainda não escolheu ou entrou como neutro (o neutro só existe no aparelho) */
  | { t: 'side'; side: Side | null }
  | { t: 'report'; r: Room; id: string }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'hello'; you: { id: string; nick: string; hue: number; side?: Side | null; auth?: boolean }; online: number; flags: Flags }
  | { t: 'snap'; s: string; d: Snap }
  | { t: 'history'; r: Room; m: ChatMsg[] }
  | { t: 'chat'; r: Room; m: ChatMsg }
  /** Super Chats recentes da sala (ao entrar): o cliente fixa no topo os que ainda estão no tempo */
  | { t: 'pins'; r: Room; m: ChatMsg[] }
  | { t: 'del'; r: Room; id: string }
  | { t: 'react'; r: Room; agg: Partial<Record<Reaction, number>> }
  | { t: 'moment'; m: Moment }
  | { t: 'online'; n: number }
  | { t: 'flags'; flags: Flags; closedRooms?: Room[] }
  | { t: 'slow'; r: Room; seconds: number }
  /** várias mensagens num frame só (o chat sai em lotes de ~250 ms) */
  | { t: 'batch'; b: ServerMsg[] }
  | {
      t: 'err';
      /** busy: a sala já entregou o máximo de mensagens por segundo; tente de novo em `wait` s */
      code: 'rate' | 'slow' | 'busy' | 'blocked' | 'closed' | 'invalid' | 'off' | 'muted' | 'auth';
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
  superchat: 'ch:sc', // payload: { r, m } (Super Chat pago, para a sala inteira)
} as const;

export const KEY = {
  snap: (s: string) => `snap:${s}`,
  chat: (r: Room) => `chat:${r}`,
  react: (r: Room) => `react:${r}`,
  /** membros por sala neste worker (JSON), para o total global que decide quantas subsalas abrir */
  members: (worker: string) => `members:${worker}`,
  /** HASH sala -> número de subsalas em vigor (o mesmo para todos os workers) */
  shards: 'shards',
  /** mensagens entregues numa subsala neste segundo (teto global) */
  cap: (shard: string, sec: number) => `cap:${shard}:${sec}`,
  online: (worker: string) => `online:${worker}`,
  flag: (f: string) => `flag:${f}`,
  roomClosed: 'flag:rooms_closed', // SET de salas desligadas
  guesses: 'count:guesses',
  /** últimos Super Chats pagos da sala (JSON de ChatMsg), para fixar no topo de quem entra */
  superchats: (r: Room) => `sc:${r}`,
  strike: (k: string) => `strike:${k}`,
} as const;

/** Super Chats guardados por sala */
export const PINS_KEEP = 30;
