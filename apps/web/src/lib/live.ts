// Conexão WebSocket única: snaps, chat, reações e momentos.
// Se cair, o placar segue pelo polling do JSON estático e o chat entra em modo degradado.
import type { ClientMsg, Reaction, Room, ServerMsg, Side } from '@apuracao/shared';
import { cheerOf, hueOf, randomNick } from '@apuracao/shared';
import { useBoard } from '../store/board';
import { useChat } from '../store/chat';
import { MOCK } from './env';

const MAX_BACKOFF = 30_000;

class Live {
  private ws: WebSocket | null = null;
  private rooms = new Map<Room, number>([['br', 1]]);
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private started = false;

  start() {
    if (this.started) return;
    this.started = true;
    if (MOCK) {
      useBoard.getState().set({ link: 'demo' });
      startMockChat();
      return;
    }
    this.connect();
    addEventListener('online', () => this.kick());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.kick();
    });
  }

  /** reconecta na hora, mesmo conectado: depois de entrar ou sair da conta, o WS precisa do cookie novo */
  reconnect() {
    if (MOCK) return;
    if (this.timer) clearTimeout(this.timer);
    if (this.ping) clearInterval(this.ping);
    const old = this.ws;
    this.ws = null;
    if (old) {
      old.onclose = null;
      old.close();
    }
    this.attempt = 0;
    this.connect();
  }

  /** reconecta já se estiver caído (voltou a rede / voltou para a aba) */
  private kick() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    if (this.timer) clearTimeout(this.timer);
    this.attempt = 0;
    this.connect();
  }

  private connect() {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    useBoard.getState().set({ link: this.attempt ? 'reconnecting' : 'connecting' });
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return this.schedule();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      useBoard.getState().set({ link: 'live' });
      this.raw({ t: 'join', rooms: [...this.rooms.keys()] });
      if (this.ping) clearInterval(this.ping);
      this.ping = setInterval(() => this.raw({ t: 'ping' }), 25_000);
    };
    ws.onmessage = (ev) => {
      try {
        handle(JSON.parse(ev.data as string) as ServerMsg);
      } catch {
        /* mensagem malformada: ignora */
      }
    };
    ws.onclose = () => {
      if (this.ping) clearInterval(this.ping);
      this.ws = null;
      this.schedule();
    };
    ws.onerror = () => ws.close();
  }

  private schedule() {
    this.attempt++;
    useBoard.getState().set({ link: this.attempt > 4 ? 'offline' : 'reconnecting' });
    const base = Math.min(MAX_BACKOFF, 1000 * 2 ** Math.min(this.attempt, 6));
    const delay = base * (0.5 + Math.random()); // jitter: evita estouro de reconexões simultâneas
    this.timer = setTimeout(() => this.connect(), delay);
  }

  private raw(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(m));
      return true;
    }
    return false;
  }

  get connected() {
    return MOCK || this.ws?.readyState === WebSocket.OPEN;
  }

  join(r: Room) {
    const n = this.rooms.get(r) ?? 0;
    this.rooms.set(r, n + 1);
    if (n === 0) this.raw({ t: 'join', rooms: [r] });
  }

  leave(r: Room) {
    const n = this.rooms.get(r) ?? 0;
    if (n <= 1 && r !== 'br') {
      this.rooms.delete(r);
      this.raw({ t: 'leave', rooms: [r] });
    } else if (n > 1) this.rooms.set(r, n - 1);
  }

  chat(r: Room, body: string): boolean {
    if (MOCK) return mockSend(r, body);
    return this.raw({ t: 'chat', r, body });
  }

  react(r: Room, e: Reaction) {
    if (MOCK) {
      const cur = useChat.getState().reacts[r] ?? {};
      useChat.getState().react(r, { ...cur, [e]: (cur[e] ?? 0) + 1 });
      return;
    }
    this.raw({ t: 'react', r, e });
  }

  nick(nick: string) {
    this.raw({ t: 'nick', nick });
  }

  /** lado da torcida (selo ao lado do apelido). Fica no aparelho e é reenviado a cada conexão. */
  side(side: Side | null) {
    try {
      if (side) localStorage.setItem('side', side);
      else localStorage.removeItem('side');
    } catch {
      /* sem storage */
    }
    const me = useBoard.getState().me;
    if (me) useBoard.getState().set({ me: { ...me, side } });
    if (!MOCK) this.raw({ t: 'side', side });
  }

  /** "manda um 13/22": torcida agregada como reação */
  cheer(r: Room, side: Side) {
    this.react(r, cheerOf(side));
  }

  report(r: Room, id: string) {
    if (MOCK) return useChat.getState().del(r, id);
    this.raw({ t: 'report', r, id });
  }
}

export function savedSide(): Side | null {
  try {
    const s = localStorage.getItem('side');
    return s === 'a' || s === 'b' ? s : null;
  } catch {
    return null;
  }
}

function handle(m: ServerMsg) {
  const board = useBoard.getState();
  const chat = useChat.getState();
  switch (m.t) {
    case 'batch':
      for (const x of m.b) handle(x);
      break;
    case 'hello': {
      // apelido personalizado vive no aparelho: reenvia a cada (re)conexão
      let custom: string | null = null;
      try {
        custom = localStorage.getItem('nick');
      } catch {
        /* sem storage */
      }
      // conta do Google: o apelido é o nome de usuário, sem personalizar
      if (m.you.auth) custom = null;
      if (custom && custom !== m.you.nick) live.nick(custom);
      const side = savedSide();
      if (side && side !== m.you.side) live.side(side);
      board.set({ online: m.online, me: { ...m.you, nick: custom || m.you.nick, side: side ?? m.you.side ?? null, auth: !!m.you.auth } });
      chat.set({ enabled: m.flags.chat });
      board.setFlags(m.flags);
      break;
    }
    case 'snap':
      board.applySnap(m.d);
      break;
    case 'history':
      chat.history(m.r, m.m);
      break;
    case 'chat':
      chat.push(m.r, m.m);
      break;
    case 'del':
      chat.del(m.r, m.id);
      break;
    case 'react':
      chat.react(m.r, m.agg);
      break;
    case 'moment':
      board.addMoment(m.m);
      break;
    case 'online':
      board.set({ online: m.n });
      break;
    case 'flags':
      board.setFlags(m.flags);
      chat.set({ enabled: m.flags.chat, closed: m.closedRooms ?? [] });
      break;
    case 'slow':
      chat.set({ slow: { ...chat.slow, [m.r]: m.seconds } });
      break;
    case 'err':
      if (m.r) chat.setErr(m.r, { code: m.code, wait: m.wait, cat: m.cat, reason: m.reason, at: Date.now() });
      // bloqueio que não foi ao chat (reincidência): aviso só neste aparelho, no próprio feed
      if (m.r && (m.code === 'blocked' || m.code === 'muted') && m.cat && !m.public) {
        const me = board.me;
        chat.push(m.r, { id: `local-${Date.now()}`, nick: me?.nick ?? 'você', hue: me?.hue ?? 0, body: '', at: Date.now(), mod: m.cat, local: true });
      }
      break;
  }
}

export const live = new Live();

// ------------------------------------------------------------------ demo local

const BOT_LINES = [
  'vai virar ou não vai?',
  'SP tá segurando',
  'olha o nordeste entrando agora',
  'calma que falta muito voto',
  'alguém de BH aí?',
  'meu palpite tá a 0,4 do parcial 👀',
  'que noite',
  'a curva tá igualzinha 2022',
  'tô vendo daqui de Manaus',
  'F5 infinito',
];

function startMockChat() {
  const bots = Array.from({ length: 8 }, () => {
    const id = Math.random().toString(36).slice(2);
    const r = Math.random();
    return { id, nick: randomNick(), hue: hueOf(id), side: r < 0.4 ? ('a' as const) : r < 0.8 ? ('b' as const) : undefined };
  });
  const tick = () => {
    const b = bots[Math.floor(Math.random() * bots.length)];
    const rooms = Object.keys(useChat.getState().msgs);
    const r = rooms.length ? rooms[Math.floor(Math.random() * rooms.length)] : 'br';
    const cands = useBoard.getState().board?.candidates;
    const mine = b.side && cands?.find((c) => c.key === b.side);
    let body = BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)];
    if (mine && Math.random() < 0.35) body = Math.random() < 0.5 ? `:${mine.n}: :${mine.n}: :${mine.n}:` : `${body} :${mine.n}:`;
    useChat.getState().push(r, {
      id: Math.random().toString(36).slice(2),
      nick: b.nick,
      hue: b.hue,
      body,
      at: Date.now(),
      ...(b.side ? { side: b.side } : {}),
    });
    const cur = useChat.getState().reacts[r] ?? {};
    const e = Math.random() < 0.6 ? (Math.random() < 0.5 ? 'cheer:a' : 'cheer:b') : '🔥';
    useChat.getState().react(r, { ...cur, [e]: (cur[e as Reaction] ?? 0) + Math.ceil(Math.random() * 12) });
    setTimeout(tick, 1500 + Math.random() * 3500);
  };
  setTimeout(tick, 800);
}

function mockSend(r: Room, body: string): boolean {
  const me = useBoard.getState().me;
  useChat.getState().push(r, {
    id: Math.random().toString(36).slice(2),
    nick: me?.nick ?? 'você',
    hue: me?.hue ?? 200,
    body,
    at: Date.now(),
  });
  return true;
}
