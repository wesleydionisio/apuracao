// Servidor WebSocket: salas, chat moderado, reações agregadas e fan-out de snapshots/momentos.
// Stateless: vários workers escalam horizontalmente via Redis; sem Redis roda sozinho em memória.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import uWS from 'uWebSockets.js';
import {
  CH,
  cleanNick,
  HISTORY_ON_JOIN,
  hueOf,
  isValidRoom,
  KEY,
  Moderator,
  nickForId,
  REACTIONS,
  roomScope,
  type ChatMsg,
  type ClientMsg,
  type Flags,
  type Moment,
  type Reaction,
  type Room,
  type ServerMsg,
  type Snap,
} from '@apuracao/shared';
import { AID_COOKIE, readCookie, verifyAid } from '@apuracao/shared/server';
import { BoardState } from './board';
import { ChatStore } from './chat';
import { config } from './config';
import { Bucket, BucketMap, RateWindow } from './limits';
import { connectRedis } from './redis';

interface UD {
  aid: string;
  /** id público (hash do aid) — o aid nunca sai do servidor */
  pub: string;
  nick: string;
  hue: number;
  side: 'a' | 'b' | null;
  ip: string;
  rooms: Set<Room>;
  msg: Bucket;
  react: Bucket;
  last: Map<Room, number>;
  open: boolean;
}
type WS = uWS.WebSocket<UD>;

const ALL = 'all';
const roomTopic = (r: Room) => `r:${r}`;
const snapTopic = (s: string) => `s:${s}`;

// prefixo IBGE -> UF, para levar momentos municipais para a sala do estado
const IBGE_UF: Record<string, string> = {
  '11': 'ro', '12': 'ac', '13': 'am', '14': 'rr', '15': 'pa', '16': 'ap', '17': 'to', '21': 'ma', '22': 'pi',
  '23': 'ce', '24': 'rn', '25': 'pb', '26': 'pe', '27': 'al', '28': 'se', '29': 'ba', '31': 'mg', '32': 'es',
  '33': 'rj', '35': 'sp', '41': 'pr', '42': 'sc', '43': 'rs', '50': 'ms', '51': 'mt', '52': 'go', '53': 'df',
};

// ---------- estado ----------
const mod = new Moderator();
mod.add(config.blockedTerms);
if (config.blockedFile) {
  try {
    mod.add(readFileSync(config.blockedFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
  } catch (e) {
    console.warn('[moderação] não consegui ler BLOCKED_FILE:', (e as Error).message);
  }
}

let flags: Flags = { chat: true, projection: true, map_mun: true };
let closedRooms = new Set<Room>();
let online = 0;
let conns = 0;
const ipConns = new Map<string, number>();
const ipBuckets = new BucketMap(config.ipBurst, config.ipRefill);
const roomMembers = new Map<Room, number>();
const roomRates = new Map<Room, RateWindow>();
const slow = new Map<Room, { seconds: number; calmSince: number | null }>();
const reactDelta = new Map<Room, Map<Reaction, number>>();
const reactAgg = new Map<Room, Partial<Record<Reaction, number>>>();
const reactSig = new Map<Room, string>();
const deleted = new Set<string>();
const m = { in: 0, out: 0, chatIn: 0, blocked: 0, rateLimited: 0, rejectedConns: 0, inRate: 0, outRate: 0 };
let lastIn = 0;
let lastOut = 0;

const bus = connectRedis(onBus, [CH.snap, CH.moment, CH.chat, CH.del, CH.flags]);
const store = new ChatStore(bus);
const board = new BoardState({
  onSnaps: (changed) => {
    for (const s of changed) publish(snapTopic(s.s), { t: 'snap', s: s.s, d: s });
  },
  onRelease: () => {
    for (const s of board.snaps.values()) publish(snapTopic(s.s), { t: 'snap', s: s.s, d: s });
  },
  onMoment: (mo) => void announceMoment(mo),
  onBoardFlags: (f) => {
    if (!bus?.ready()) setFlags(f, closedRooms);
  },
});

const app = uWS.App();

// ---------- envio ----------
function send(ws: WS, msg: ServerMsg) {
  if (!ws.getUserData().open) return;
  try {
    ws.send(JSON.stringify(msg));
    m.out++;
  } catch {
    /* socket fechou no meio de um await */
  }
}

function publish(topic: string, msg: ServerMsg) {
  app.publish(topic, JSON.stringify(msg));
  m.out += app.numSubscribers(topic);
}

const newId = () => Date.now().toString(36) + randomBytes(4).toString('hex');

// ---------- Redis pub/sub ----------
function onBus(channel: string, payload: string) {
  try {
    const d = JSON.parse(payload);
    if (channel === CH.snap) board.apply(Array.isArray(d) ? (d as Snap[]) : [d as Snap]);
    else if (channel === CH.moment) board.moment(d as Moment);
    else if (channel === CH.chat) deliver(d.r, d.m, d.a);
    else if (channel === CH.del) applyDelete(d.r, d.id);
    else if (channel === CH.flags) void reloadFlags();
  } catch (e) {
    console.warn('[bus]', channel, (e as Error).message);
  }
}

// ---------- chat ----------
/** entrega local de uma mensagem (de qualquer worker) */
function deliver(room: Room, msg: ChatMsg, author?: string) {
  if (!isValidRoom(room) || !msg?.id) return;
  store.mirror(room, msg, JSON.stringify(msg), author);
  if (!msg.sys) rateOf(room).hit();
  publish(roomTopic(room), { t: 'chat', r: room, m: msg });
}

function rateOf(room: Room) {
  let w = roomRates.get(room);
  if (!w) roomRates.set(room, (w = new RateWindow()));
  return w;
}

function applyDelete(room: Room, id: string) {
  if (deleted.has(id)) return;
  deleted.add(id);
  if (deleted.size > 10_000) deleted.delete(deleted.values().next().value!);
  void store.remove(room, id);
  publish(roomTopic(room), { t: 'del', r: room, id });
}

async function postChat(ws: WS, room: Room, body: unknown) {
  const ud = ws.getUserData();
  if (!flags.chat) return send(ws, { t: 'err', code: 'off', r: room });
  if (!ud.rooms.has(room)) return send(ws, { t: 'err', code: 'invalid', r: room });
  if (closedRooms.has(room)) return send(ws, { t: 'err', code: 'closed', r: room });
  const chk = mod.check(body);
  if (!chk.ok) {
    if (chk.reason === 'blocked') m.blocked++;
    return send(ws, { t: 'err', code: chk.reason, r: room });
  }
  const now = Date.now();
  const sl = slow.get(room);
  const last = ud.last.get(room) ?? 0;
  if (sl && sl.seconds > 0 && now - last < sl.seconds * 1000) {
    m.rateLimited++;
    return send(ws, { t: 'err', code: 'slow', r: room, wait: Math.ceil((sl.seconds * 1000 - (now - last)) / 1000) });
  }
  if (!ipBuckets.take(ud.ip) || !ud.msg.take()) {
    m.rateLimited++;
    return send(ws, { t: 'err', code: 'rate', r: room, wait: Math.ceil(ud.msg.wait() / 1000) });
  }
  ud.last.set(room, now);
  m.chatIn++;
  const msg: ChatMsg = { id: newId(), nick: ud.nick, hue: ud.hue, body: chk.body, at: now, ...(ud.side ? { side: ud.side } : {}) };
  if (bus?.ready()) {
    try {
      await store.persist(room, JSON.stringify(msg));
      await bus.cmd.publish(CH.chat, JSON.stringify({ r: room, m: msg, a: ud.pub }));
      return; // volta pela assinatura e é entregue em todos os workers, inclusive este
    } catch (e) {
      console.warn('[chat] Redis falhou, entregando local:', (e as Error).message);
    }
  }
  deliver(room, msg, ud.pub);
}

async function report(ws: WS, room: Room, id: unknown) {
  const ud = ws.getUserData();
  if (typeof id !== 'string' || id.length > 40 || !ud.rooms.has(room) || deleted.has(id)) return;
  const author = store.authorOf(id);
  if (author === ud.pub || id.startsWith('sys-')) return;
  const n = await store.report(id, ud.pub);
  if (n < config.reportsToDelete) return;
  if (bus?.ready()) {
    try {
      await store.remove(room, id);
      await bus.cmd.publish(CH.del, JSON.stringify({ r: room, id }));
      return;
    } catch {
      /* local */
    }
  }
  applyDelete(room, id);
}

async function announceMoment(mo: Moment) {
  publish(ALL, { t: 'moment', m: mo });
  const rooms: Room[] = ['br'];
  if (mo.scope.startsWith('uf:')) rooms.push(mo.scope.slice(3).toLowerCase());
  else if (mo.scope.startsWith('mun:')) {
    const uf = IBGE_UF[mo.scope.slice(4, 6)];
    if (uf) rooms.push(uf);
  }
  const id = `sys-${createHash('sha1').update(mo.id).digest('hex').slice(0, 12)}`;
  const msg: ChatMsg = { id, nick: 'Apuração', hue: 0, body: mo.title, at: Date.parse(mo.at) || Date.now(), sys: true };
  // todos os workers entregam localmente; só um grava no histórico compartilhado
  let persist = false;
  if (bus?.ready()) {
    persist = (await bus.cmd.set(`lock:${id}`, '1', 'EX', 86_400, 'NX').catch(() => null)) === 'OK';
  }
  for (const r of rooms) {
    deliver(r, msg);
    if (persist) void store.persist(r, JSON.stringify(msg)).catch(() => {});
  }
}

// ---------- reações ----------
function react(ws: WS, room: Room, e: unknown) {
  const ud = ws.getUserData();
  if (!ud.rooms.has(room) || !REACTIONS.includes(e as Reaction) || !ud.react.take()) return;
  let d = reactDelta.get(room);
  if (!d) reactDelta.set(room, (d = new Map()));
  d.set(e as Reaction, (d.get(e as Reaction) ?? 0) + 1);
}

async function flushReactions() {
  const deltas = [...reactDelta.entries()];
  reactDelta.clear();
  const active = [...roomMembers.keys()];
  if (bus?.ready()) {
    try {
      const pipe = bus.cmd.pipeline();
      for (const [room, d] of deltas) for (const [e, n] of d) pipe.hincrby(KEY.react(room), e, n);
      for (const room of active) pipe.hgetall(KEY.react(room));
      const res = (await pipe.exec()) ?? [];
      const reads = res.slice(res.length - active.length);
      active.forEach((room, i) => {
        const raw = (reads[i]?.[1] ?? {}) as Record<string, string>;
        const agg: Partial<Record<Reaction, number>> = {};
        for (const [k, v] of Object.entries(raw)) agg[k as Reaction] = Number(v);
        reactAgg.set(room, agg);
      });
    } catch {
      mergeLocal(deltas);
    }
  } else mergeLocal(deltas);
  for (const room of active) {
    const agg = reactAgg.get(room);
    if (!agg) continue;
    const sig = JSON.stringify(agg);
    if (reactSig.get(room) === sig) continue;
    reactSig.set(room, sig);
    publish(roomTopic(room), { t: 'react', r: room, agg });
  }
}

function mergeLocal(deltas: [Room, Map<Reaction, number>][]) {
  for (const [room, d] of deltas) {
    const agg = reactAgg.get(room) ?? {};
    for (const [e, n] of d) agg[e] = (agg[e] ?? 0) + n;
    reactAgg.set(room, agg);
  }
}

// ---------- slow mode ----------
function tickSlowMode() {
  const now = Date.now();
  for (const [room, w] of roomRates) {
    const rate = w.tick();
    const st = slow.get(room);
    if (rate > config.slowTrigger) {
      if (!st || st.seconds === 0) {
        slow.set(room, { seconds: config.slowSeconds, calmSince: null });
        publish(roomTopic(room), { t: 'slow', r: room, seconds: config.slowSeconds });
      } else st.calmSince = null;
    } else if (st && st.seconds > 0) {
      if (rate < config.slowTrigger / 2) {
        st.calmSince ??= now;
        if (now - st.calmSince > 30_000) {
          slow.delete(room);
          publish(roomTopic(room), { t: 'slow', r: room, seconds: 0 });
        }
      } else st.calmSince = null;
    } else if (rate === 0 && !roomMembers.has(room)) roomRates.delete(room);
  }
}

// ---------- flags ----------
function setFlags(f: Flags, closed: Set<Room>) {
  const changed = JSON.stringify(f) !== JSON.stringify(flags) || [...closed].sort().join() !== [...closedRooms].sort().join();
  flags = f;
  closedRooms = closed;
  if (changed) publish(ALL, { t: 'flags', flags, closedRooms: [...closedRooms] });
}

async function reloadFlags() {
  if (!bus?.ready()) return;
  try {
    const [c, p, mm] = await bus.cmd.mget(KEY.flag('chat'), KEY.flag('projection'), KEY.flag('map_mun'));
    const closed = await bus.cmd.smembers(KEY.roomClosed);
    setFlags({ chat: c !== '0', projection: p !== '0', map_mun: mm !== '0' }, new Set(closed));
  } catch {
    /* mantém o que tinha */
  }
}

// ---------- online ----------
async function reportOnline() {
  if (!bus?.ready()) return void (online = conns);
  try {
    await bus.cmd.set(KEY.online(config.workerId), String(conns), 'EX', 15);
    let cursor = '0';
    let sum = 0;
    do {
      const [next, keys] = await bus.cmd.scan(cursor, 'MATCH', KEY.online('*'), 'COUNT', 200);
      cursor = next;
      if (keys.length) for (const v of await bus.cmd.mget(...keys)) sum += Number(v) || 0;
    } while (cursor !== '0');
    online = sum;
  } catch {
    online = conns;
  }
}

// ---------- join / leave ----------
async function join(ws: WS, rooms: unknown) {
  const ud = ws.getUserData();
  if (!Array.isArray(rooms)) return send(ws, { t: 'err', code: 'invalid' });
  for (const r of rooms.slice(0, 10)) {
    if (!isValidRoom(r)) {
      send(ws, { t: 'err', code: 'invalid', r: String(r).slice(0, 40) });
      continue;
    }
    if (ud.rooms.has(r)) continue;
    if (ud.rooms.size >= config.maxRoomsPerConn) {
      send(ws, { t: 'err', code: 'invalid', r });
      break;
    }
    ud.rooms.add(r);
    roomMembers.set(r, (roomMembers.get(r) ?? 0) + 1);
    ws.subscribe(roomTopic(r));
    const scope = roomScope(r);
    if (scope && scope !== 'br') {
      ws.subscribe(snapTopic(scope));
      const s = board.get(scope);
      if (s) send(ws, { t: 'snap', s: scope, d: s });
    }
    const agg = reactAgg.get(r);
    if (agg) send(ws, { t: 'react', r, agg });
    const sl = slow.get(r);
    if (sl?.seconds) send(ws, { t: 'slow', r, seconds: sl.seconds });
    const hist = await store.history(r, HISTORY_ON_JOIN);
    if (ud.open && ud.rooms.has(r)) send(ws, { t: 'history', r, m: hist.filter((x) => !deleted.has(x.id)) });
  }
}

function leave(ws: WS, rooms: unknown) {
  const ud = ws.getUserData();
  if (!Array.isArray(rooms)) return;
  for (const r of rooms) {
    if (typeof r !== 'string' || !ud.rooms.delete(r)) continue;
    dropMember(r);
    ws.unsubscribe(roomTopic(r));
    const scope = roomScope(r);
    if (scope && scope !== 'br') ws.unsubscribe(snapTopic(scope));
  }
}

function dropMember(r: Room) {
  const n = (roomMembers.get(r) ?? 1) - 1;
  if (n <= 0) roomMembers.delete(r);
  else roomMembers.set(r, n);
}

// ---------- servidor ----------
const decoder = new TextDecoder();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

app.ws<UD>('/ws', {
  compression: uWS.DISABLED,
  maxPayloadLength: 1024,
  idleTimeout: 120,
  sendPingsAutomatically: true,
  maxBackpressure: 256 * 1024,
  closeOnBackpressureLimit: false,

  upgrade: (res, req, context) => {
    const key = req.getHeader('sec-websocket-key');
    const proto = req.getHeader('sec-websocket-protocol');
    const ext = req.getHeader('sec-websocket-extensions');
    const origin = req.getHeader('origin');
    const cookie = req.getHeader('cookie');
    const fwd = config.trustProxy
      ? req.getHeader('cf-connecting-ip') || req.getHeader('x-forwarded-for').split(',')[0].trim()
      : '';
    const ip = fwd || Buffer.from(res.getRemoteAddressAsText()).toString();
    if (allowedOrigins.length && origin && !allowedOrigins.includes(origin)) {
      m.rejectedConns++;
      res.writeStatus('403 Forbidden').end('origin');
      return;
    }
    if ((ipConns.get(ip) ?? 0) >= config.ipConnLimit) {
      m.rejectedConns++;
      res.writeStatus('429 Too Many Requests').end('too many connections');
      return;
    }
    const aid = verifyAid(readCookie(cookie, AID_COOKIE), config.secret) ?? `e-${randomBytes(12).toString('hex')}`;
    const pub = createHash('sha256').update(aid).digest('base64url').slice(0, 10);
    res.upgrade<UD>(
      {
        aid,
        pub,
        nick: nickForId(aid),
        hue: hueOf(aid),
        side: null,
        ip,
        rooms: new Set(),
        msg: new Bucket(config.userBurst, config.userRefill),
        react: new Bucket(config.reactBurst, config.reactRefill),
        last: new Map(),
        open: true,
      },
      key,
      proto,
      ext,
      context,
    );
  },

  open: (ws) => {
    const ud = ws.getUserData();
    conns++;
    ipConns.set(ud.ip, (ipConns.get(ud.ip) ?? 0) + 1);
    ws.subscribe(ALL);
    ws.subscribe(snapTopic('br'));
    send(ws, { t: 'hello', you: { id: ud.pub, nick: ud.nick, hue: ud.hue, side: ud.side }, online: Math.max(online, conns), flags });
    if (closedRooms.size) send(ws, { t: 'flags', flags, closedRooms: [...closedRooms] });
    const br = board.get('br');
    if (br) send(ws, { t: 'snap', s: 'br', d: br });
  },

  message: (ws, data, isBinary) => {
    m.in++;
    if (isBinary) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(decoder.decode(data));
    } catch {
      return send(ws, { t: 'err', code: 'invalid' });
    }
    const ud = ws.getUserData();
    switch (msg?.t) {
      case 'join':
        return void join(ws, msg.rooms).catch(() => {});
      case 'leave':
        return leave(ws, msg.rooms);
      case 'chat':
        return void postChat(ws, msg.r, msg.body).catch(() => {});
      case 'react':
        return react(ws, msg.r, msg.e);
      case 'nick': {
        const n = cleanNick(msg.nick, mod);
        if (!n) return send(ws, { t: 'err', code: 'invalid' });
        ud.nick = n;
        return send(ws, { t: 'hello', you: { id: ud.pub, nick: ud.nick, hue: ud.hue, side: ud.side }, online: Math.max(online, conns), flags });
      }
      case 'side': {
        ud.side = msg.side === 'a' || msg.side === 'b' ? msg.side : null;
        return send(ws, { t: 'hello', you: { id: ud.pub, nick: ud.nick, hue: ud.hue, side: ud.side }, online: Math.max(online, conns), flags });
      }
      case 'report':
        return void report(ws, msg.r, msg.id).catch(() => {});
      case 'ping':
        return send(ws, { t: 'pong' });
      default:
        return send(ws, { t: 'err', code: 'invalid' });
    }
  },

  close: (ws) => {
    const ud = ws.getUserData();
    ud.open = false;
    conns--;
    const n = (ipConns.get(ud.ip) ?? 1) - 1;
    if (n <= 0) ipConns.delete(ud.ip);
    else ipConns.set(ud.ip, n);
    for (const r of ud.rooms) dropMember(r);
  },
});

const snapAge = () => (board.lastSnapAt ? Math.round((Date.now() - board.lastSnapAt) / 1000) : -1);
const boardAge = () => (board.boardGeneratedAt ? Math.round((Date.now() - Date.parse(board.boardGeneratedAt)) / 1000) : -1);

app.get('/health', (res) => {
  res.writeHeader('content-type', 'application/json').end(
    JSON.stringify({
      ok: true,
      worker: config.workerId,
      conns,
      online,
      redis: bus ? bus.ready() : 'off',
      released: board.released(),
      lastSnapAgeS: snapAge(),
      boardAgeS: boardAge(),
    }),
  );
});

app.get('/metrics', (res) => {
  const lines = [
    `ws_connections ${conns}`,
    `ws_online_global ${online}`,
    `ws_rooms_local ${roomMembers.size}`,
    `ws_msgs_in_per_s ${m.inRate.toFixed(1)}`,
    `ws_msgs_out_per_s ${m.outRate.toFixed(1)}`,
    `ws_msgs_in_total ${m.in}`,
    `ws_msgs_out_total ${m.out}`,
    `ws_chat_in_total ${m.chatIn}`,
    `ws_chat_blocked_total ${m.blocked}`,
    `ws_chat_rate_limited_total ${m.rateLimited}`,
    `ws_conns_rejected_total ${m.rejectedConns}`,
    `ws_slow_rooms ${[...slow.values()].filter((s) => s.seconds > 0).length}`,
    `ws_redis_ready ${bus?.ready() ? 1 : 0}`,
    `ws_released ${board.released() ? 1 : 0}`,
    `ws_last_snapshot_age_seconds ${snapAge()}`,
    `ws_board_age_seconds ${boardAge()}`,
    `ws_heap_mb ${(process.memoryUsage().heapUsed / 1e6).toFixed(1)}`,
  ];
  res.writeHeader('content-type', 'text/plain; version=0.0.4').end(lines.join('\n') + '\n');
});

app.any('/*', (res) => {
  res.writeStatus('404 Not Found').end('not found');
});

let listenSocket: uWS.us_listen_socket | null = null;
app.listen(config.host, config.port, (ls) => {
  if (!ls) {
    console.error(`[ws] não consegui escutar em ${config.host}:${config.port}`);
    process.exit(1);
  }
  listenSocket = ls;
  console.log(
    `[ws] ${config.workerId} em :${config.port} — ${bus ? 'Redis' : 'modo arquivo/memória'}, dados em ${config.dataDir}`,
  );
});

// ---------- timers ----------
void board.pollFile();
setInterval(() => void board.pollFile(), config.filePollMs);
setInterval(() => void flushReactions().catch(() => {}), 1000);
setInterval(tickSlowMode, 1000);
setInterval(() => {
  m.inRate = (m.in - lastIn) / 5;
  m.outRate = (m.out - lastOut) / 5;
  lastIn = m.in;
  lastOut = m.out;
  ipBuckets.sweep();
}, 5000);
setInterval(() => void reloadFlags(), 5000);
setInterval(() => void reportOnline(), 5000);
setInterval(() => publish(ALL, { t: 'online', n: Math.max(online, conns) }), 10_000);
void reloadFlags();

function shutdown() {
  console.log('[ws] encerrando');
  if (listenSocket) uWS.us_listen_socket_close(listenSocket);
  const done = () => process.exit(0);
  if (bus?.ready()) bus.cmd.del(KEY.online(config.workerId)).finally(done);
  else done();
  setTimeout(done, 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
