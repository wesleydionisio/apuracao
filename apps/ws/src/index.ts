// Servidor WebSocket: salas, chat moderado, reações agregadas e fan-out de snapshots/momentos.
// Stateless: vários workers escalam horizontalmente via Redis; sem Redis roda sozinho em memória.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import uWS from 'uWebSockets.js';
import {
  CH,
  cleanNick,
  hasLink,
  HISTORY_ON_JOIN,
  hueOf,
  isValidRoom,
  KEY,
  Moderator,
  normalize,
  nickForId,
  PINS_KEEP,
  REACTIONS,
  roomScope,
  type ChatMsg,
  type ClientMsg,
  type Flags,
  type ModCategory,
  type Moment,
  type Reaction,
  type Room,
  type ServerMsg,
  type Snap,
} from '@apuracao/shared';
import { AID_COOKIE, readCookie, SESSION_COOKIE, verifyAid, verifySession } from '@apuracao/shared/server';
import { BoardState } from './board';
import { ChatStore } from './chat';
import { config } from './config';
import { Bucket, BucketMap, RateWindow } from './limits';
import { AiModerator, type Verdict } from './moderation-ai';
import { connectRedis } from './redis';
import { jump, nextShardCount, shardId, shardKey } from './shards';
import { Strikes, WEIGHT, type Ladder } from './strikes';

interface UD {
  aid: string;
  /** id público (hash do aid) — o aid nunca sai do servidor */
  pub: string;
  nick: string;
  hue: number;
  side: 'a' | 'b' | null;
  /** entrou com o Google: só assim manda mensagem, e o apelido é o nome de usuário da conta */
  auth: boolean;
  ip: string;
  rooms: Set<Room>;
  /** chave estável para escolher a subsala (jump hash) */
  skey: bigint;
  /** subsala em que a pessoa está em cada sala */
  shard: Map<Room, number>;
  msg: Bucket;
  react: Bucket;
  last: Map<Room, number>;
  open: boolean;
  /** insistências no limite de taxa (3 seguidas viram ponto de spam) */
  rateHits: number;
  rateAt: number;
  /** últimas mensagens (normalizadas) para pegar repetição */
  recent: { k: string; at: number }[];
}
type WS = uWS.WebSocket<UD>;

const ALL = 'all';
/** a sala inteira: torcida/reações, momentos, exclusões */
const roomTopic = (r: Room) => `r:${r}`;
/** o fluxo de mensagens de uma subsala */
const chatTopic = (shard: string) => `c:${shard}`;
const snapTopic = (s: string) => `s:${s}`;
const roomOfShard = (shard: string) => shard.slice(0, shard.lastIndexOf('#'));

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
const roomSockets = new Map<Room, Set<WS>>();
/** subsalas em vigor por sala (vem do Redis, igual em todos os workers) */
const shardCount = new Map<Room, number>();
/** taxa e modo lento são por subsala ("br#3") */
const roomRates = new Map<string, RateWindow>();
const slow = new Map<string, { seconds: number; calmSince: number | null }>();
/** próximo lote por tópico de subsala (JSON já serializado) */
const outbox = new Map<string, string[]>();
const capLocal = new Map<string, { sec: number; n: number }>();
const reactDelta = new Map<Room, Map<Reaction, number>>();
const reactAgg = new Map<Room, Partial<Record<Reaction, number>>>();
const reactSig = new Map<Room, string>();
const deleted = new Set<string>();
/** Super Chats recentes por sala (modo memória; com Redis a lista fica em KEY.superchats) */
const pinsMem = new Map<Room, ChatMsg[]>();
/**
 * frames de histórico e de pins já serializados por sala: uma rajada de joins (reconexão em massa) usa a
 * mesma string. O histórico vale enquanto a sala não muda (versão do espelho); os pins, até chegar/sair um Super Chat.
 */
const JOIN_CACHE_MS = 1000;
const histFrames = new Map<Room, { at: number; v: number; s: Promise<string> }>();
const pinFrames = new Map<Room, { at: number; s: Promise<string | null> }>();
let joinCacheHits = 0;
const m = { superchats: 0, in: 0, out: 0, chatIn: 0, blocked: 0, punished: 0, muted: 0, rateLimited: 0, busy: 0, rejectedConns: 0, inRate: 0, outRate: 0 };
let lastIn = 0;
let lastOut = 0;

const bus = connectRedis(onBus, [CH.snap, CH.moment, CH.chat, CH.del, CH.flags, CH.superchat]);
const store = new ChatStore(bus);
const strikes = new Strikes(bus);
const ai = new AiModerator(config.mod);
console.log(ai.enabled ? `[moderação-ia] ligada: ${config.mod.model}` : '[moderação-ia] desligada (sem OPENROUTER_API_KEY): só filtro local');
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
// frames pequenos (pong, online) não compensam o deflate
const zip = (s: string) => config.compress && s.length >= config.compressMin;

function send(ws: WS, msg: ServerMsg) {
  sendRaw(ws, JSON.stringify(msg));
}

function sendRaw(ws: WS, s: string) {
  if (!ws.getUserData().open) return;
  try {
    ws.send(s, false, zip(s));
    m.out++;
  } catch {
    /* socket fechou no meio de um await */
  }
}

function publish(topic: string, msg: ServerMsg) {
  publishRaw(topic, JSON.stringify(msg));
}

function publishRaw(topic: string, s: string) {
  app.publish(topic, s, false, zip(s));
  m.out += app.numSubscribers(topic);
}

/** chat vai em lote: junta o que chegar na janela e manda um frame por subsala */
function queue(topic: string, msg: ServerMsg) {
  let q = outbox.get(topic);
  if (!q) outbox.set(topic, (q = []));
  q.push(JSON.stringify(msg));
}

function flushOutbox() {
  for (const [topic, q] of outbox) publishRaw(topic, q.length === 1 ? q[0] : `{"t":"batch","b":[${q.join(',')}]}`);
  outbox.clear();
}

const newId = () => Date.now().toString(36) + randomBytes(4).toString('hex');

// ---------- Redis pub/sub ----------
function onBus(channel: string, payload: string) {
  try {
    const d = JSON.parse(payload);
    if (channel === CH.snap) board.apply(Array.isArray(d) ? (d as Snap[]) : [d as Snap]);
    else if (channel === CH.moment) board.moment(d as Moment);
    else if (channel === CH.chat) deliver(d.r, typeof d.k === 'number' ? d.k : 0, d.m, d.a);
    else if (channel === CH.del) applyDelete(d.r, d.id);
    else if (channel === CH.superchat) deliverSuper(d.r, d.m);
    else if (channel === CH.flags) void reloadFlags();
  } catch (e) {
    console.warn('[bus]', channel, (e as Error).message);
  }
}

// ---------- chat ----------
/**
 * entrega local de uma mensagem (de qualquer worker). `k` é a subsala do autor; null (momentos do
 * sistema) vai para a sala inteira. O histórico é um só por sala: quem entra vê a sala toda.
 */
function deliver(room: Room, k: number | null, msg: ChatMsg, author?: string) {
  if (!isValidRoom(room) || !msg?.id) return;
  store.mirror(room, msg, JSON.stringify(msg), author);
  const out: ServerMsg = { t: 'chat', r: room, m: msg };
  if (k === null) return publish(roomTopic(room), out);
  const id = shardId(room, k);
  if (!msg.sys) rateOf(id).hit();
  queue(chatTopic(id), out);
}

/**
 * Super Chat pago (a API grava no Redis e publica): vai para a sala inteira, todas as subsalas,
 * sem passar pelo teto nem pelo modo lento. Já foi moderado antes do Pix ser gerado.
 */
function deliverSuper(room: Room, msg: ChatMsg) {
  if (!isValidRoom(room) || !msg?.id || typeof msg.sc !== 'number' || deleted.has(msg.id)) return;
  store.mirror(room, msg, JSON.stringify(msg));
  const list = pinsMem.get(room) ?? [];
  if (list.some((x) => x.id === msg.id)) return;
  list.push(msg);
  if (list.length > PINS_KEEP) list.splice(0, list.length - PINS_KEEP);
  pinsMem.set(room, list);
  pinFrames.delete(room);
  m.superchats++;
  publish(roomTopic(room), { t: 'chat', r: room, m: msg });
}

async function pinsOf(room: Room): Promise<ChatMsg[]> {
  if (bus?.ready()) {
    try {
      const rows = await bus.cmd.lrange(KEY.superchats(room), 0, PINS_KEEP - 1);
      return rows.reverse().map((r) => JSON.parse(r) as ChatMsg);
    } catch {
      /* memória */
    }
  }
  return pinsMem.get(room) ?? [];
}

function rateOf(shard: string) {
  let w = roomRates.get(shard);
  if (!w) roomRates.set(shard, (w = new RateWindow()));
  return w;
}

const shardOf = (ud: UD, room: Room) => ud.shard.get(room) ?? 0;

/** teto global de mensagens por segundo na subsala (Redis; sem ele, por worker) */
async function takeCap(shard: string, now: number): Promise<boolean> {
  const sec = Math.floor(now / 1000);
  if (bus?.ready()) {
    try {
      const key = KEY.cap(shard, sec);
      const res = await bus.cmd.multi().incr(key).expire(key, 5).exec();
      return Number(res?.[0]?.[1]) <= config.chatCap;
    } catch {
      /* cai para o contador local */
    }
  }
  const c = capLocal.get(shard);
  if (!c || c.sec !== sec) {
    capLocal.set(shard, { sec, n: 1 });
    return config.chatCap >= 1;
  }
  return ++c.n <= config.chatCap;
}

function applyDelete(room: Room, id: string) {
  if (deleted.has(id)) return;
  deleted.add(id);
  if (deleted.size > 10_000) deleted.delete(deleted.values().next().value!);
  void store.remove(room, id);
  const pins = pinsMem.get(room);
  if (pins) pinsMem.set(room, pins.filter((x) => x.id !== id));
  pinFrames.delete(room);
  publish(roomTopic(room), { t: 'del', r: room, id });
}

async function setNick(ws: WS, raw: unknown) {
  const ud = ws.getUserData();
  if (ud.auth) return; // o apelido de quem entrou é o nome de usuário da conta
  if (await strikes.muted(ud.pub, ud.ip)) return send(ws, { t: 'err', code: 'invalid' });
  const n = cleanNick(raw, mod);
  if (!n) return send(ws, { t: 'err', code: 'invalid' });
  const v = await ai.classify(n);
  if (!ud.open) return;
  if (ai.isFlagged(v) && v.cat !== 'spam') {
    await strikes.add(ud.pub, ud.ip, 'abuse', WEIGHT[v.cat]);
    return send(ws, { t: 'err', code: 'invalid' });
  }
  ud.nick = n;
  send(ws, { t: 'hello', you: { id: ud.pub, nick: ud.nick, hue: ud.hue, side: ud.side, auth: ud.auth }, online: Math.max(online, conns), flags });
}

/** recusa a mensagem, soma pontos na escada e avisa (bloqueio simples ou silêncio) */
async function punish(ws: WS, room: Room, ladder: Ladder, cat: ModCategory) {
  const ud = ws.getUserData();
  const pen = await strikes.add(ud.pub, ud.ip, ladder, ladder === 'abuse' ? WEIGHT[cat] : 1);
  m.punished++;
  // primeira mensagem barrada da pessoa: todos veem "bloqueada pela moderação" (sem o texto).
  // Das seguintes ninguém fica sabendo: não vale dar palco para quem insiste.
  if (pen.first) {
    await broadcast(room, shardOf(ud, room), { id: newId(), nick: ud.nick, hue: ud.hue, body: '', at: Date.now(), mod: cat, ...(ud.side ? { side: ud.side } : {}) }, ud.pub);
  }
  if (!ud.open) return;
  const pub = pen.first ? { public: true as const } : {};
  if (pen.mute > 0) {
    m.muted++;
    return send(ws, { t: 'err', code: 'muted', r: room, wait: pen.mute, reason: ladder, cat, ...pub });
  }
  return send(ws, { t: 'err', code: 'blocked', r: room, cat, ...pub });
}

/** 3 insistências no limite de taxa em 30s = 1 ponto de spam; devolve true se já respondeu */
async function rateStrike(ws: WS, room: Room): Promise<boolean> {
  const ud = ws.getUserData();
  const now = Date.now();
  if (now - ud.rateAt > 30_000) ud.rateHits = 0;
  ud.rateAt = now;
  if (++ud.rateHits < 3) return false;
  ud.rateHits = 0;
  const pen = await strikes.add(ud.pub, ud.ip, 'spam', 1);
  if (pen.mute > 0 && ud.open) {
    m.muted++;
    send(ws, { t: 'err', code: 'muted', r: room, wait: pen.mute, reason: 'spam', cat: 'spam' });
    return true;
  }
  return false;
}

async function postChat(ws: WS, room: Room, body: unknown) {
  const ud = ws.getUserData();
  if (!flags.chat) return send(ws, { t: 'err', code: 'off', r: room });
  if (!ud.auth) return send(ws, { t: 'err', code: 'auth', r: room });
  if (!ud.rooms.has(room)) return send(ws, { t: 'err', code: 'invalid', r: room });
  if (closedRooms.has(room)) return send(ws, { t: 'err', code: 'closed', r: room });
  // 1. silêncio em vigor (por pessoa ou IP)
  const muted = await strikes.muted(ud.pub, ud.ip);
  if (muted) return send(ws, { t: 'err', code: 'muted', r: room, wait: muted.wait, reason: muted.reason });
  // 2. filtro local: tamanho, links, lista de termos
  const chk = mod.check(body);
  if (!chk.ok) {
    if (chk.reason === 'invalid') return send(ws, { t: 'err', code: 'invalid', r: room });
    m.blocked++;
    const text = String(body);
    // o filtro local não sabe a gravidade: o modelo diz (palavrão pesa menos que racismo)
    const v = hasLink(text) ? null : await ai.classify(text);
    const cat: ModCategory = hasLink(text) ? 'link' : v && ai.isFlagged(v) && v.cat !== 'spam' ? v.cat : 'palavrao';
    return punish(ws, room, cat === 'link' ? 'spam' : 'abuse', cat);
  }
  // 3. modo lento (da subsala) e limite de taxa; insistir vira spam
  const now = Date.now();
  const shard = shardId(room, shardOf(ud, room));
  const sl = slow.get(shard);
  const last = ud.last.get(room) ?? 0;
  if (sl && sl.seconds > 0 && now - last < sl.seconds * 1000) {
    m.rateLimited++;
    if (await rateStrike(ws, room)) return;
    return send(ws, { t: 'err', code: 'slow', r: room, wait: Math.ceil((sl.seconds * 1000 - (now - last)) / 1000) });
  }
  if (!ipBuckets.take(ud.ip) || !ud.msg.take()) {
    m.rateLimited++;
    if (await rateStrike(ws, room)) return;
    return send(ws, { t: 'err', code: 'rate', r: room, wait: Math.ceil(ud.msg.wait() / 1000) });
  }
  // 4. repetição: a mesma mensagem em 60s
  const k = normalize(chk.body);
  ud.recent = ud.recent.filter((r) => now - r.at < 60_000);
  if (k && ud.recent.some((r) => r.k === k)) return punish(ws, room, 'spam', 'spam');
  ud.recent.push({ k, at: now });
  if (ud.recent.length > 5) ud.recent.shift();
  // 5. teto da subsala: a banda por pessoa fica limitada, por maior que a sala seja
  if (!(await takeCap(shard, now))) {
    m.busy++;
    return send(ws, { t: 'err', code: 'busy', r: room, wait: 2 });
  }
  // 6. modelo de decisão (só o que passou pelos filtros baratos chega aqui)
  const v: Verdict = await ai.classify(chk.body);
  if (!ud.open) return;
  if (ai.isFlagged(v)) {
    m.blocked++;
    return punish(ws, room, v.cat === 'spam' ? 'spam' : 'abuse', v.cat);
  }
  ud.last.set(room, now);
  m.chatIn++;
  const msg: ChatMsg = { id: newId(), nick: ud.nick, hue: ud.hue, body: chk.body, at: now, ...(ud.side ? { side: ud.side } : {}) };
  await broadcast(room, shardOf(ud, room), msg, ud.pub);
}

/** grava e entrega para a subsala `k` (todos os workers via Redis, ou local) */
async function broadcast(room: Room, k: number, msg: ChatMsg, author: string) {
  if (bus?.ready()) {
    try {
      await store.persist(room, JSON.stringify(msg));
      await bus.cmd.publish(CH.chat, JSON.stringify({ r: room, k, m: msg, a: author }));
      return; // volta pela assinatura e é entregue em todos os workers, inclusive este
    } catch (e) {
      console.warn('[chat] Redis falhou, entregando local:', (e as Error).message);
    }
  }
  deliver(room, k, msg, author);
}

async function report(ws: WS, room: Room, id: unknown) {
  const ud = ws.getUserData();
  if (typeof id !== 'string' || id.length > 40 || !ud.rooms.has(room) || deleted.has(id)) return;
  const author = store.authorOf(id);
  // Super Chat passou pela moderação antes do Pix; quem tira do ar é o painel admin
  if (author === ud.pub || id.startsWith('sys-') || id.startsWith('sc-')) return;
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
    deliver(r, null, msg);
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
  // a torcida é da sala inteira (todas as subsalas somam no mesmo placar)
  const active = [...roomSockets.keys()];
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
  for (const [shard, w] of roomRates) {
    const rate = w.tick();
    const st = slow.get(shard);
    const room = roomOfShard(shard);
    if (rate > config.slowTrigger) {
      if (!st || st.seconds === 0) {
        slow.set(shard, { seconds: config.slowSeconds, calmSince: null });
        publish(chatTopic(shard), { t: 'slow', r: room, seconds: config.slowSeconds });
      } else st.calmSince = null;
    } else if (st && st.seconds > 0) {
      if (rate < config.slowTrigger / 2) {
        st.calmSince ??= now;
        if (now - st.calmSince > 30_000) {
          slow.delete(shard);
          publish(chatTopic(shard), { t: 'slow', r: room, seconds: 0 });
        }
      } else st.calmSince = null;
    } else if (rate === 0 && !st) roomRates.delete(shard);
  }
}

// ---------- subsalas ----------
/**
 * A cada 5s: soma as pessoas de cada sala em todos os workers e decide quantas subsalas ela tem.
 * O número fica no Redis para todos os workers concordarem; quem muda de subsala só passa a ver
 * outro fluxo de mensagens (sem aviso, sem perder o que já estava na tela).
 */
async function rebalance() {
  const local: Record<Room, number> = {};
  for (const [r, s] of roomSockets) local[r] = s.size;
  let totals = local;
  let stored: Record<string, string> = {};
  if (bus?.ready()) {
    try {
      await bus.cmd.set(KEY.members(config.workerId), JSON.stringify(local), 'EX', 15);
      const sum: Record<Room, number> = {};
      let cursor = '0';
      do {
        const [next, keys] = await bus.cmd.scan(cursor, 'MATCH', KEY.members('*'), 'COUNT', 200);
        cursor = next;
        if (!keys.length) continue;
        for (const v of await bus.cmd.mget(...keys)) {
          try {
            for (const [r, n] of Object.entries(JSON.parse(v ?? '{}') as Record<Room, number>)) sum[r] = (sum[r] ?? 0) + n;
          } catch {
            /* worker com JSON estranho: ignora */
          }
        }
      } while (cursor !== '0');
      stored = await bus.cmd.hgetall(KEY.shards);
      totals = sum;
    } catch {
      totals = local;
      stored = {};
    }
  }
  const updates: Record<string, number> = {};
  for (const r of new Set([...Object.keys(totals), ...Object.keys(stored)])) {
    const cur = Number(stored[r]) || shardCount.get(r) || 1;
    const n = nextShardCount(cur, totals[r] ?? 0, config.shardSize);
    if (stored[r] ? Number(stored[r]) !== n : n > 1) updates[r] = n;
    applyShards(r, n);
  }
  if (bus?.ready() && Object.keys(updates).length) await bus.cmd.hset(KEY.shards, updates).catch(() => {});
}

/** muda o número de subsalas da sala e remaneja só quem o jump hash mandou para outra */
function applyShards(r: Room, n: number) {
  if ((shardCount.get(r) ?? 1) === n) return;
  shardCount.set(r, n);
  for (const ws of roomSockets.get(r) ?? []) {
    const ud = ws.getUserData();
    const old = ud.shard.get(r);
    const k = jump(ud.skey, n);
    if (old === k) continue;
    if (old !== undefined) ws.unsubscribe(chatTopic(shardId(r, old)));
    ud.shard.set(r, k);
    ws.subscribe(chatTopic(shardId(r, k)));
    const was = old !== undefined ? (slow.get(shardId(r, old))?.seconds ?? 0) : 0;
    const now = slow.get(shardId(r, k))?.seconds ?? 0;
    if (was !== now) send(ws, { t: 'slow', r, seconds: now });
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
function cacheSet<T>(map: Map<Room, T>, r: Room, e: T) {
  map.set(r, e);
  if (map.size > 5000) map.delete(map.keys().next().value!);
}

function historyFrame(r: Room): Promise<string> {
  const now = Date.now();
  const v = store.version(r);
  const c = histFrames.get(r);
  if (c && c.v === v && now - c.at < JOIN_CACHE_MS) {
    joinCacheHits++;
    return c.s;
  }
  const s = store.history(r, HISTORY_ON_JOIN).then((h) => {
    const msg: ServerMsg = { t: 'history', r, m: h.filter((x) => !deleted.has(x.id)) };
    return JSON.stringify(msg);
  });
  cacheSet(histFrames, r, { at: now, v, s });
  return s;
}

function pinsFrame(r: Room): Promise<string | null> {
  const now = Date.now();
  const c = pinFrames.get(r);
  if (c && now - c.at < JOIN_CACHE_MS) return c.s;
  const s = pinsOf(r).then((p) => {
    const live = p.filter((x) => !deleted.has(x.id));
    const msg: ServerMsg = { t: 'pins', r, m: live };
    return live.length ? JSON.stringify(msg) : null;
  });
  cacheSet(pinFrames, r, { at: now, s });
  return s;
}

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
    let set = roomSockets.get(r);
    if (!set) roomSockets.set(r, (set = new Set()));
    set.add(ws);
    ws.subscribe(roomTopic(r));
    const k = jump(ud.skey, shardCount.get(r) ?? 1);
    ud.shard.set(r, k);
    ws.subscribe(chatTopic(shardId(r, k)));
    const scope = roomScope(r);
    if (scope && scope !== 'br') {
      ws.subscribe(snapTopic(scope));
      const s = board.get(scope);
      if (s) send(ws, { t: 'snap', s: scope, d: s });
    }
    const agg = reactAgg.get(r);
    if (agg) send(ws, { t: 'react', r, agg });
    const sl = slow.get(shardId(r, k));
    if (sl?.seconds) send(ws, { t: 'slow', r, seconds: sl.seconds });
    const [hist, pins] = await Promise.all([historyFrame(r), pinsFrame(r)]);
    if (!ud.open || !ud.rooms.has(r)) continue;
    sendRaw(ws, hist);
    if (pins) sendRaw(ws, pins);
  }
}

function leave(ws: WS, rooms: unknown) {
  const ud = ws.getUserData();
  if (!Array.isArray(rooms)) return;
  for (const r of rooms) {
    if (typeof r !== 'string' || !ud.rooms.delete(r)) continue;
    dropMember(r, ws);
    ws.unsubscribe(roomTopic(r));
    const k = ud.shard.get(r);
    if (k !== undefined) ws.unsubscribe(chatTopic(shardId(r, k)));
    ud.shard.delete(r);
    const scope = roomScope(r);
    if (scope && scope !== 'br') ws.unsubscribe(snapTopic(scope));
  }
}

function dropMember(r: Room, ws: WS) {
  const set = roomSockets.get(r);
  if (!set) return;
  set.delete(ws);
  if (!set.size) roomSockets.delete(r);
}

// ---------- servidor ----------
const decoder = new TextDecoder();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

app.ws<UD>('/ws', {
  // deflate sem janela por conexão: barato em memória, e o publish comprime uma vez para todos
  compression: config.compress ? uWS.SHARED_COMPRESSOR : uWS.DISABLED,
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
    // com sessão, a identidade é a conta (mesmo apelido e cor em qualquer aparelho); sem, o cookie anônimo
    const session = verifySession(readCookie(cookie, SESSION_COOKIE), config.secret);
    const aid = session ? `u-${session.uid}` : (verifyAid(readCookie(cookie, AID_COOKIE), config.secret) ?? `e-${randomBytes(12).toString('hex')}`);
    const digest = createHash('sha256').update(aid).digest();
    const pub = digest.toString('base64url').slice(0, 10);
    res.upgrade<UD>(
      {
        aid,
        pub,
        nick: session ? session.user : nickForId(aid),
        hue: hueOf(session ? session.uid : aid),
        side: null,
        auth: !!session,
        ip,
        rooms: new Set(),
        skey: shardKey(digest),
        shard: new Map(),
        msg: new Bucket(config.userBurst, config.userRefill),
        react: new Bucket(config.reactBurst, config.reactRefill),
        last: new Map(),
        open: true,
        rateHits: 0,
        rateAt: 0,
        recent: [],
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
    send(ws, { t: 'hello', you: { id: ud.pub, nick: ud.nick, hue: ud.hue, side: ud.side, auth: ud.auth }, online: Math.max(online, conns), flags });
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
      case 'nick':
        return void setNick(ws, msg.nick).catch(() => {});
      case 'side': {
        ud.side = msg.side === 'a' || msg.side === 'b' ? msg.side : null;
        return send(ws, { t: 'hello', you: { id: ud.pub, nick: ud.nick, hue: ud.hue, side: ud.side, auth: ud.auth }, online: Math.max(online, conns), flags });
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
    for (const r of ud.rooms) dropMember(r, ws);
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

/**
 * Sem Redis (dev): a API entrega Super Chats e exclusões por aqui. Com Redis vai tudo pelo pub/sub.
 * Fora do Caddy (só /ws é exposto) e com o segredo compartilhado no cabeçalho.
 */
app.post('/internal', (res, req) => {
  const ok = req.getHeader('x-internal') === config.secret;
  let aborted = false;
  res.onAborted(() => (aborted = true));
  let buf = Buffer.alloc(0);
  res.onData((chunk, last) => {
    buf = Buffer.concat([buf, Buffer.from(chunk)]);
    if (!last || aborted) return;
    if (!ok || buf.length > 8192) return void res.cork(() => res.writeStatus('403 Forbidden').end());
    try {
      const d = JSON.parse(buf.toString());
      if (d.t === 'sc') deliverSuper(d.r, d.m);
      else if (d.t === 'del') applyDelete(d.r, d.id);
      res.cork(() => res.end('ok'));
    } catch {
      res.cork(() => res.writeStatus('400 Bad Request').end());
    }
  });
});

app.get('/metrics', (res) => {
  const lines = [
    `ws_connections ${conns}`,
    `ws_online_global ${online}`,
    `ws_rooms_local ${roomSockets.size}`,
    `ws_shards_max ${Math.max(1, ...shardCount.values())}`,
    `ws_chat_busy_total ${m.busy}`,
    `ws_msgs_in_per_s ${m.inRate.toFixed(1)}`,
    `ws_msgs_out_per_s ${m.outRate.toFixed(1)}`,
    `ws_msgs_in_total ${m.in}`,
    `ws_msgs_out_total ${m.out}`,
    `ws_chat_in_total ${m.chatIn}`,
    `ws_chat_blocked_total ${m.blocked}`,
    `ws_chat_rate_limited_total ${m.rateLimited}`,
    `ws_chat_punished_total ${m.punished}`,
    `ws_chat_muted_total ${m.muted}`,
    `ws_superchats_total ${m.superchats}`,
    `ws_history_mem_total ${store.stats.mem}`,
    `ws_history_redis_total ${store.stats.redis}`,
    `ws_join_cache_hits_total ${joinCacheHits}`,
    `ws_muted_cache_hits_total ${strikes.cacheHits}`,
    `ws_mod_ai_enabled ${ai.enabled ? 1 : 0}`,
    `ws_mod_ai_circuit_open ${ai.circuitOpen ? 1 : 0}`,
    `ws_mod_ai_calls_total ${ai.stats.calls}`,
    `ws_mod_ai_messages_total ${ai.stats.messages}`,
    `ws_mod_ai_cache_hits_total ${ai.stats.cacheHits}`,
    `ws_mod_ai_flagged_total ${ai.stats.flagged}`,
    `ws_mod_ai_errors_total ${ai.stats.errors}`,
    `ws_mod_ai_timeouts_total ${ai.stats.timeouts}`,
    `ws_mod_ai_unknown_total ${ai.stats.unknown}`,
    `ws_mod_ai_last_ms ${ai.stats.lastMs}`,
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
setInterval(() => void flushReactions().catch(() => {}), config.reactFlushMs);
setInterval(flushOutbox, config.chatBatchMs);
setInterval(tickSlowMode, 1000);
setInterval(() => void rebalance().catch(() => {}), 5000);
void rebalance().catch(() => {});
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
  if (bus?.ready()) bus.cmd.del(KEY.online(config.workerId), KEY.members(config.workerId)).finally(done);
  else done();
  setTimeout(done, 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
