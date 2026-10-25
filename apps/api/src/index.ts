// API: palpites, cidade, estatísticas, cards PNG e HTML com metas OG. Stateless (escala em cluster).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { Redis } from 'ioredis';
import {
  CH,
  cleanNick,
  fmtPct,
  hasLink,
  hueOf,
  inUf,
  isReleased,
  isValidRoom,
  KEY,
  Moderator,
  nickForId,
  PINS_KEEP,
  SC_MAX,
  SC_MIN,
  SC_PIX_TTL_MS,
  scTier,
  fmtBrl,
  type CandidateDef,
  type ChatMsg,
  type ModCategory,
  type Municipality,
  type ScCharge,
  ufName,
  UFS,
  wireSide,
} from '@apuracao/shared';
import { AiModerator, aiModConfig } from '@apuracao/shared/moderation-ai';
import { AID_COOKIE, clientIp, newAid, SESSION_COOKIE, signToken, verifyAid, verifySession, verifyToken } from '@apuracao/shared/server';
import { OAuth2Client } from 'google-auth-library';
import pg from 'pg';
import { FileAccounts, PgAccounts, type Account, type AccountStore } from './accounts';
import { config } from './config';
import { board, cityPayload, munBoard, municipalities } from './data';
import { renderHtml, type Meta } from './html';
import { Busy, cached, guessCard, POSTERS, scoreCard, stripEmoji, teaserCard, type Format } from './og';
import { createCharge, fetchPayment, providerOf, qrPng, simulateWooviPayment, wooviSandbox } from './pix';
import { cleanSite, Site } from './site';
import { FileStore, newId, PgStore, type GuessStore, type StoredGuess } from './store';
import { SuperChats, type SuperChat } from './superchats';

// em produção, sem as 2 linhas de log por requisição (a 300 req/s viram 600 linhas/s no json-file do Docker); warn/error seguem
const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  disableRequestLogging: config.production,
  trustProxy: true,
  bodyLimit: 4096,
});
const mod = new Moderator();
mod.add(config.blockedTerms);
if (config.blockedFile) {
  try {
    mod.add(readFileSync(config.blockedFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
  } catch (e) {
    console.warn('[moderação] não consegui ler BLOCKED_FILE:', (e as Error).message);
  }
}
const ai = new AiModerator(aiModConfig());
const superchats = new SuperChats(config.varDir, config.databaseUrl);
const pixProvider = providerOf(config.pix);
const site = new Site(config.varDir, config.dataDir, config.adWhatsapp);
const store: GuessStore = config.databaseUrl
  ? new PgStore(config.databaseUrl, path.join(config.repo, 'infra/schema.sql'))
  : new FileStore(config.varDir);
const accounts: AccountStore = config.databaseUrl
  ? new PgAccounts(new pg.Pool({ connectionString: config.databaseUrl, max: 3 }))
  : new FileAccounts(config.varDir);
const google = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;
const redis = config.redisUrl ? new Redis(config.redisUrl, { maxRetriesPerRequest: 2, enableOfflineQueue: false }) : null;
redis?.on('error', (e) => app.log.warn({ err: e.message }, 'redis'));

await app.register(cookie);
if (config.serveData) {
  await app.register(fastifyStatic, {
    root: config.dataDir,
    prefix: '/data/',
    decorateReply: false,
    setHeaders: (res, file) =>
      res.setHeader('cache-control', file.includes(`${path.sep}static${path.sep}`) ? 'public, max-age=3600' : 'public, s-maxage=5, stale-while-revalidate=30'),
  });
}

// ---------- identidade anônima ----------
const nickFor = nickForId;

function identity(req: FastifyRequest, reply: FastifyReply): string {
  const id = verifyAid(req.cookies[AID_COOKIE], config.secret);
  if (id) return id;
  const fresh = newAid(config.secret);
  reply.setCookie(AID_COOKIE, fresh.cookie, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.publicUrl.startsWith('https'),
    maxAge: 60 * 60 * 24 * 60,
  });
  return fresh.id;
}

// ---------- rate limit simples por IP (o Cloudflare tem a regra principal em /api/guess) ----------
const buckets = new Map<string, { tokens: number; at: number }>();
function allow(key: string, burst: number, perSecond: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: burst, at: now };
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * perSecond);
  b.at = now;
  buckets.set(key, b);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}
setInterval(() => {
  const old = Date.now() - 10 * 60_000;
  for (const [k, b] of buckets) if (b.at < old) buckets.delete(k);
}, 60_000).unref();

const ipOf = (req: FastifyRequest) => clientIp(req.headers, req.ip);
const ipHash = (ip: string) => createHash('sha256').update(`${ip}|${config.secret}`).digest('hex').slice(0, 32);

// ---------- helpers ----------
const candidates = (): CandidateDef[] | null => board()?.candidates ?? null;
const pctOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : null;
};

function publicGuess(g: StoredGuess) {
  const { anonId: _a, ipHash: _i, ...pub } = g;
  return pub;
}

function liveOf(g: StoredGuess) {
  const b = board();
  if (!b?.released || !b.br || !b.br.valid) return null;
  const idx = store.index;
  const pa = b.br.pa;
  const dist = Math.round(Math.abs(g.pa - pa) * 100) / 100;
  const live: Record<string, number> = { pa, dist, rank: idx.national.rank(pa, dist), total: idx.national.total };
  const uf = g.uf ? b.ufs[`uf:${g.uf}`] : null;
  const ufHist = g.uf ? idx.uf.get(g.uf) : null;
  if (uf?.valid && g.ufPa !== null && ufHist) {
    const d = Math.abs(g.ufPa - uf.pa);
    live.ufPa = uf.pa;
    live.ufRank = ufHist.rank(uf.pa, d);
    live.ufTotal = ufHist.total;
  }
  const m = g.mun ? municipalities().byIbge.get(g.mun) : null;
  const ms = m ? munBoard(m.uf)?.mun[m.ibge] : null;
  const munHist = g.mun ? idx.mun.get(g.mun) : null;
  if (ms?.valid && g.munPa !== null && munHist) {
    const d = Math.abs(g.munPa - ms.pa);
    live.munPa = ms.pa;
    live.munRank = munHist.rank(ms.pa, d);
    live.munTotal = munHist.total;
  }
  return live;
}

// ---------- API ----------
app.get('/api/health', async () => ({ ok: true, boardAt: board()?.generatedAt ?? null }));

app.get('/api/me', async (req, reply) => {
  const id = identity(req, reply);
  reply.header('cache-control', 'private, no-store');
  return { id, nick: nickFor(id), hue: hueOf(id) };
});

// ---------- contas do chat (login com o Google) ----------
// Entrar: o Google devolve um ID token; conta existente → cookie `sid`. Conta nova → um token curto
// assinado com os dados do Google, trocado por conta + cookie no cadastro (nome, celular, usuário).
interface Pending {
  sub: string;
  email: string;
  name: string;
  exp: number;
}

const userOf = (a: Account) => ({ username: a.username, hue: hueOf(a.id) });

function startSession(reply: FastifyReply, a: Account) {
  reply.setCookie(SESSION_COOKIE, signToken({ uid: a.id, user: a.username }, config.secret), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.publicUrl.startsWith('https'),
    maxAge: 60 * 60 * 24 * 180,
  });
  return { user: userOf(a) };
}

async function signIn(reply: FastifyReply, sub: string, email: string, name: string) {
  const a = await accounts.bySub(sub);
  if (a) return startSession(reply, a);
  const token = signToken({ sub, email, name, exp: Date.now() + 30 * 60_000 } satisfies Pending, config.secret);
  return { signup: { token, name, email } };
}

/** celular brasileiro com DDD: 10 ou 11 dígitos (aceita +55) */
function cleanPhone(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let d = v.replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  return /^[1-9]{2}9?\d{8}$/.test(d) ? d : null;
}

// sem GOOGLE_CLIENT_ID e fora de produção: entrar com um e-mail qualquer, para testar o fluxo localmente
const devLogin = !config.googleClientId && process.env.NODE_ENV !== 'production';

app.get('/api/auth/me', async (req, reply) => {
  reply.header('cache-control', 'private, no-store');
  const s = verifySession(req.cookies[SESSION_COOKIE], config.secret);
  return { user: s ? { username: s.user, hue: hueOf(s.uid) } : null, google: config.googleClientId || null, dev: devLogin };
});

app.post<{ Body: Record<string, unknown> }>('/api/auth/google', async (req, reply) => {
  if (!google) return reply.code(404).send({ error: 'off' });
  if (!allow(`auth:${ipOf(req)}`, 60, 1)) return reply.code(429).send({ error: 'rate' });
  const credential = req.body?.credential;
  if (typeof credential !== 'string') return reply.code(400).send({ error: 'invalid' });
  try {
    const t = await google.verifyIdToken({ idToken: credential, audience: config.googleClientId });
    const p = t.getPayload();
    if (!p?.sub || !p.email || p.email_verified === false) return reply.code(401).send({ error: 'google' });
    return await signIn(reply, `google:${p.sub}`, p.email, p.name ?? '');
  } catch {
    return reply.code(401).send({ error: 'google' });
  }
});

app.post<{ Body: Record<string, unknown> }>('/api/auth/dev', async (req, reply) => {
  if (!devLogin) return reply.code(404).send({ error: 'off' });
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return reply.code(400).send({ error: 'invalid' });
  return signIn(reply, `dev:${email}`, email, email.split('@')[0]);
});

app.post<{ Body: Record<string, unknown> }>('/api/auth/signup', async (req, reply) => {
  if (!allow(`signup:${ipOf(req)}`, 60, 1)) return reply.code(429).send({ error: 'rate' });
  const b = req.body ?? {};
  const p = verifyToken<Pending>(typeof b.token === 'string' ? b.token : null, config.secret);
  if (!p?.sub) return reply.code(401).send({ error: 'expired' });
  const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim() : '';
  if (name.length < 2 || name.length > 80) return reply.code(400).send({ error: 'name' });
  const phone = cleanPhone(b.phone);
  if (!phone) return reply.code(400).send({ error: 'phone' });
  const username = cleanNick(b.username, mod);
  if (!username) return reply.code(400).send({ error: 'username' });
  const existing = await accounts.bySub(p.sub);
  if (existing) return startSession(reply, existing);
  if (await accounts.usernameTaken(username)) return reply.code(409).send({ error: 'taken' });
  const a: Account = { id: newId(), googleSub: p.sub, email: p.email, name, phone, username, createdAt: new Date().toISOString() };
  if (!(await accounts.create(a))) return reply.code(409).send({ error: 'taken' });
  return startSession(reply, a);
});

app.get<{ Querystring: { u?: string } }>('/api/auth/username', async (req) => {
  const u = cleanNick(req.query.u, mod);
  return { ok: !!u && !(await accounts.usernameTaken(u)), valid: !!u };
});

app.post('/api/auth/logout', async (_req, reply) => {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  return { ok: true };
});

app.post<{ Body: Record<string, unknown> }>('/api/guess', async (req, reply) => {
  reply.header('cache-control', 'no-store');
  if (isReleased(new Date(), config.releaseAt)) return reply.code(403).send({ error: 'closed' });
  const ip = ipOf(req);
  if (!allow(`g:${ip}`, 60, 2)) return reply.code(429).send({ error: 'rate' });
  const anonId = identity(req, reply);
  const b = req.body ?? {};
  const pa = pctOrNull(b.pa);
  if (pa === null) return reply.code(400).send({ error: 'pa' });
  const nick = cleanNick(b.nick, mod) ?? nickFor(anonId);
  const uf = typeof b.uf === 'string' && /^[A-Z]{2}$/.test(b.uf) ? b.uf : null;
  const munRow = typeof b.mun === 'string' ? municipalities().byIbge.get(b.mun) : undefined;
  const now = new Date().toISOString();
  const prevId = store.index.byAnon.get(anonId);
  const prev = prevId ? store.index.byId.get(prevId) : undefined;
  const g: StoredGuess = {
    id: prev?.id ?? newId(),
    anonId,
    nick,
    pa,
    uf: uf ?? munRow?.uf ?? null,
    ufPa: uf || munRow ? pctOrNull(b.ufPa) : null,
    mun: munRow?.ibge ?? null,
    munPa: munRow ? pctOrNull(b.munPa) : null,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    ipHash: ipHash(ip),
  };
  await store.save(g);
  if (!prev) redis?.incr(KEY.guesses).catch(() => {});
  return { guess: publicGuess(g), url: `${config.publicUrl}/p/${g.id}` };
});

app.get<{ Params: { id: string } }>('/api/guess/:id', async (req, reply) => {
  const g = store.index.byId.get(req.params.id);
  if (!g) return reply.code(404).send({ error: 'not_found' });
  reply.header('cache-control', 'public, s-maxage=10, stale-while-revalidate=30');
  return { guess: publicGuess(g), live: liveOf(g), final: board()?.br?.status === 'totalizado' };
});

function cityReply(m: Municipality | undefined, reply: FastifyReply) {
  if (!m) return reply.code(404).send({ error: 'not_found' });
  reply.header('cache-control', 'public, s-maxage=10, stale-while-revalidate=30');
  return cityPayload(m);
}
app.get<{ Params: { ibge: string } }>('/api/city/:ibge', async (req, reply) =>
  cityReply(municipalities().byIbge.get(req.params.ibge), reply),
);
app.get<{ Params: { uf: string; slug: string } }>('/api/city/by-slug/:uf/:slug', async (req, reply) =>
  cityReply(municipalities().bySlug.get(`${req.params.uf.toLowerCase()}/${req.params.slug}`), reply),
);

let onlineMemo: { at: number; n: number | null } | null = null;
async function onlineCount(): Promise<number | null> {
  if (onlineMemo && Date.now() - onlineMemo.at < 5000) return onlineMemo.n;
  const n = await scanOnline();
  onlineMemo = { at: Date.now(), n };
  return n;
}

async function scanOnline(): Promise<number | null> {
  if (!redis) return null;
  try {
    let cursor = '0';
    let sum = 0;
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', KEY.online('*'), 'COUNT', 200);
      cursor = next;
      if (keys.length) for (const v of await redis.mget(...keys)) sum += Number(v ?? 0);
    } while (cursor !== '0');
    return sum;
  } catch {
    return null;
  }
}

// "hype" do palpite: quantos entraram na última hora e quanto do Brasil acha que A leva (recalculado a cada 30s)
let pulseMemo: { at: number; lastHour: number; aWins: number | null } | null = null;
function guessPulse() {
  if (pulseMemo && Date.now() - pulseMemo.at < 30_000) return pulseMemo;
  const since = new Date(Date.now() - 3_600_000).toISOString();
  let lastHour = 0;
  for (const g of store.index.byId.values()) if (g.createdAt >= since) lastHour++;
  const c = store.index.national.counts;
  let above = 0;
  let below = 0;
  for (let k = 0; k < c.length; k++) {
    if (k > 5000) above += c[k];
    else if (k < 5000) below += c[k];
  }
  pulseMemo = { at: Date.now(), lastHour, aWins: above + below ? Math.round((above / (above + below)) * 1000) / 10 : null };
  return pulseMemo;
}

app.get('/api/stats', async (_req, reply) => {
  reply.header('cache-control', 'public, s-maxage=10, stale-while-revalidate=30');
  const byIbge = municipalities().byIbge;
  const pulse = guessPulse();
  return {
    online: await onlineCount(),
    guesses: store.index.byId.size,
    guessesLastHour: pulse.lastHour,
    /** % dos palpites que dão a vitória ao candidato A */
    guessAWins: pulse.aWins,
    recentGuesses: store.index.recent.slice(-10).map((g) => ({ nick: g.nick, pa: g.pa, at: g.at })),
    topCities: store.index.topCities(10).map(([ibge, n]) => {
      const m = byIbge.get(ibge);
      return { ibge, name: m?.name ?? ibge, uf: m?.uf ?? '', n };
    }),
  };
});

// "onde estão os palpites": distribuição nacional em faixas de 0,5 ponto (30–70%; fora disso cai na ponta)
const HIST_MIN = 30;
const HIST_MAX = 70;
const HIST_STEP = 0.5;
let histMemo: { at: number; bins: { pa: number; n: number }[]; total: number } | null = null;
function guessHistogram() {
  if (histMemo && Date.now() - histMemo.at < 5000) return histMemo;
  const counts = store.index.national.counts;
  const nBins = Math.round((HIST_MAX - HIST_MIN) / HIST_STEP);
  const bins = Array.from({ length: nBins }, (_, i) => ({ pa: HIST_MIN + i * HIST_STEP, n: 0 }));
  let total = 0;
  for (let k = 0; k < counts.length; k++) {
    const c = counts[k];
    if (!c) continue;
    const i = Math.min(nBins - 1, Math.max(0, Math.floor((k / 100 - HIST_MIN) / HIST_STEP)));
    bins[i].n += c;
    total += c;
  }
  histMemo = { at: Date.now(), bins, total };
  return histMemo;
}

app.get<{ Querystring: { me?: string } }>('/api/guesses/hist', async (req, reply) => {
  const { bins, total } = guessHistogram();
  if (req.query.me !== '1') {
    reply.header('cache-control', 'public, s-maxage=30, stale-while-revalidate=60');
    return { bins, total };
  }
  // com ?me=1 a resposta é pessoal: nunca em cache compartilhado
  reply.header('cache-control', 'private, no-store');
  const id = verifyAid(req.cookies[AID_COOKIE], config.secret);
  const gid = id ? store.index.byAnon.get(id) : undefined;
  const mine = gid ? store.index.byId.get(gid)?.pa : undefined;
  return { bins, total, ...(mine !== undefined ? { mine } : {}) };
});

app.post<{ Body: Record<string, unknown> }>('/api/admin/flags', async (req, reply) => {
  if (!adminOk(req)) return reply.code(401).send({ error: 'auth' });
  if (!redis) return reply.code(501).send({ error: 'sem redis' });
  const b = req.body ?? {};
  const m = redis.multi();
  for (const f of ['chat', 'projection', 'map_mun'] as const) if (typeof b[f] === 'boolean') m.set(KEY.flag(f), b[f] ? '1' : '0');
  if (typeof b.closeRoom === 'string') m.sadd(KEY.roomClosed, b.closeRoom);
  if (typeof b.openRoom === 'string') m.srem(KEY.roomClosed, b.openRoom);
  m.publish(CH.flags, '1');
  await m.exec();
  return { ok: true };
});

// ---------- Super Chat (Pix) ----------
// A mensagem passa pela mesma moderação do chat ANTES do Pix ser gerado: ninguém paga por algo que seria barrado.
// Pago (webhook da Woovi, consulta de status ou conferência manual no painel), vai para o chat da sala.
const scView = async (s: SuperChat): Promise<ScCharge> => ({
  id: s.id,
  status: superchats.statusOf(s),
  amount: s.amount,
  qr: s.qr,
  qrPng: await qrPng(s.qr),
  expiresAt: s.expiresAt,
  provider: s.provider,
  ...(s.provider === 'woovi' && wooviSandbox(config.pix) ? { sandbox: true } : {}),
});

/** o mesmo id público que o WS usa para a conta (as punições do chat ficam guardadas por ele) */
const pubOf = (uid: string) => createHash('sha256').update(`u-${uid}`).digest().toString('base64url').slice(0, 10);

async function mutedNow(uid: string): Promise<boolean> {
  if (!redis) return false;
  try {
    const raw = await redis.get(KEY.strike(`u:${pubOf(uid)}`));
    return !!raw && (JSON.parse(raw) as { muteUntil?: number }).muteUntil! > Date.now();
  } catch {
    return false;
  }
}

/** entrega ao WS: Redis (todos os workers) ou HTTP direto no worker único do dev */
async function toWs(payload: { t: 'sc'; r: string; m: ChatMsg } | { t: 'del'; r: string; id: string }, json?: string) {
  if (redis) {
    const m = redis.multi();
    if (payload.t === 'sc') {
      m.lpush(KEY.chat(payload.r), json!).ltrim(KEY.chat(payload.r), 0, 199);
      m.lpush(KEY.superchats(payload.r), json!).ltrim(KEY.superchats(payload.r), 0, PINS_KEEP - 1);
      m.publish(CH.superchat, JSON.stringify({ r: payload.r, m: payload.m }));
    } else {
      if (json) m.lrem(KEY.chat(payload.r), 1, json).lrem(KEY.superchats(payload.r), 1, json);
      m.publish(CH.del, JSON.stringify({ r: payload.r, id: payload.id }));
    }
    await m.exec();
    return;
  }
  await fetch(`${config.wsInternal}/internal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal': config.secret },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(3000),
  });
}

async function markPaid(s: SuperChat, via: string) {
  if (s.status === 'paid' || s.status === 'hidden') return;
  s.status = 'paid';
  s.paidAt = new Date().toISOString();
  const msg: ChatMsg = { id: `sc-${s.id}`, nick: s.username, hue: s.hue, body: s.body, at: Date.parse(s.paidAt), sc: s.amount, ...(s.side ? { side: s.side } : {}) };
  s.json = JSON.stringify(msg);
  await superchats.save(s);
  app.log.info({ id: s.id, amount: s.amount, via }, 'superchat pago');
  await toWs({ t: 'sc', r: s.room, m: msg }, s.json).catch((e) => app.log.error({ err: (e as Error).message, id: s.id }, 'superchat não entregue ao WS'));
}

/** pendente na Woovi: consulta no máximo a cada 5s por cobrança (o webhook pode atrasar ou nem vir) */
const lastCheck = new Map<string, number>();
async function refresh(s: SuperChat) {
  if (s.provider !== 'woovi' || !s.pid || superchats.statusOf(s) !== 'pending') return;
  if (Date.now() - (lastCheck.get(s.id) ?? 0) < 5000) return;
  lastCheck.set(s.id, Date.now());
  const p = await fetchPayment(config.pix, s.pid).catch(() => null);
  if (p?.approved && p.cents >= s.amount) await markPaid(s, 'consulta');
}

app.post<{ Body: Record<string, unknown> }>('/api/superchat', async (req, reply) => {
  reply.header('cache-control', 'private, no-store');
  if (!pixProvider) return reply.code(404).send({ error: 'off' });
  const sess = verifySession(req.cookies[SESSION_COOKIE], config.secret);
  if (!sess) return reply.code(401).send({ error: 'auth' });
  if (!allow(`sc:${sess.uid}`, 6, 1 / 30) || !allow(`sc-ip:${ipOf(req)}`, 20, 0.2)) return reply.code(429).send({ error: 'rate' });
  const b = req.body ?? {};
  const room = b.room;
  if (!isValidRoom(room)) return reply.code(400).send({ error: 'room' });
  const amount = Math.round(Number(b.amount));
  if (!Number.isFinite(amount) || amount < SC_MIN || amount > SC_MAX) return reply.code(400).send({ error: 'amount' });
  const tier = scTier(amount);
  let body = '';
  if (typeof b.body === 'string' && b.body.trim()) {
    const chk = mod.check(b.body);
    if (!chk.ok) {
      if (chk.reason === 'invalid') return reply.code(400).send({ error: 'invalid' });
      // como no chat: o filtro local barra, o modelo diz a gravidade
      const v = await ai.classify(String(b.body));
      const cat: ModCategory = hasLink(String(b.body)) ? 'link' : ai.isFlagged(v) && v.cat !== 'spam' ? v.cat : 'palavrao';
      return reply.code(422).send({ error: 'blocked', cat });
    }
    if ([...chk.body].length > tier.chars) return reply.code(400).send({ error: 'long', max: tier.chars });
    const v = await ai.classify(chk.body);
    if (ai.isFlagged(v)) return reply.code(422).send({ error: 'blocked', cat: v.cat });
    body = chk.body;
  }
  if (await mutedNow(sess.uid)) return reply.code(403).send({ error: 'muted' });
  const acc = await accounts.byId(sess.uid);
  if (!acc) return reply.code(401).send({ error: 'auth' });
  const id = randomBytes(8).toString('hex');
  const expiresAt = new Date(Date.now() + SC_PIX_TTL_MS);
  let charge;
  try {
    charge = await createCharge(config.pix, pixProvider, { id, cents: amount, email: acc.email, description: `Super Chat ${fmtBrl(amount)}`, expiresAt });
  } catch (e) {
    app.log.error({ err: (e as Error).message }, 'pix');
    return reply.code(502).send({ error: 'pix' });
  }
  const s: SuperChat = {
    id,
    room,
    uid: acc.id,
    username: acc.username,
    hue: hueOf(acc.id),
    side: wireSide(b.side),
    body,
    amount,
    status: 'pending',
    provider: pixProvider,
    pid: charge.pid,
    qr: charge.qr,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
    paidAt: null,
    json: null,
  };
  await superchats.save(s);
  return scView(s);
});

/** quem pagou acompanha o status (a tela consulta a cada 3s enquanto o QR está aberto) */
app.get<{ Params: { id: string } }>('/api/superchat/:id', async (req, reply) => {
  reply.header('cache-control', 'private, no-store');
  const sess = verifySession(req.cookies[SESSION_COOKIE], config.secret);
  const s = superchats.byId.get(req.params.id);
  if (!sess || !s || s.uid !== sess.uid) return reply.code(404).send({ error: 'not_found' });
  await refresh(s);
  return scView(s);
});

app.post<{ Params: { id: string } }>('/api/superchat/:id/dev-pay', async (req, reply) => {
  const sess = verifySession(req.cookies[SESSION_COOKIE], config.secret);
  const s = superchats.byId.get(req.params.id);
  const sandbox = s?.provider === 'woovi' && wooviSandbox(config.pix);
  if (!sess || !s || s.uid !== sess.uid || (s.provider !== 'dev' && !sandbox)) return reply.code(404).send({ error: 'not_found' });
  if (superchats.statusOf(s) === 'expired') return reply.code(410).send({ error: 'expired' });
  if (sandbox) {
    // paga de verdade no sandbox; a confirmação vem pelo webhook ou pela consulta, como em produção
    if (!(await simulateWooviPayment(config.pix, s.pid!).catch(() => false))) return reply.code(502).send({ error: 'pix' });
    lastCheck.delete(s.id);
    await refresh(s);
  } else await markPaid(s, 'dev');
  return scView(s);
});

// A Woovi avisa aqui (evento OPENPIX:CHARGE_COMPLETED, com a cobrança no corpo). O aviso só dispara a consulta:
// o que vale é a API deles, então um POST forjado não paga nada. O teste de cadastro do webhook recebe 200.
app.post<{ Body: Record<string, any> }>('/api/pix/webhook', async (req) => {
  if (pixProvider !== 'woovi') return { ok: true };
  const ref = String(req.body?.charge?.correlationID ?? '');
  const s = ref ? superchats.byId.get(ref) : undefined;
  if (!s?.pid) return { ok: true };
  const p = await fetchPayment(config.pix, s.pid).catch(() => null);
  if (p?.approved && p.cents >= s.amount) await markPaid(s, 'webhook');
  return { ok: true };
});

// ---------- painel admin (header x-admin-token) ----------
// Em dev sem ADMIN_TOKEN o token é "admin"; em produção sem ADMIN_TOKEN o painel fica desligado.
const adminToken = config.adminToken || (config.production ? '' : 'admin');
function adminOk(req: FastifyRequest): boolean {
  const t = String(req.headers['x-admin-token'] ?? '');
  if (!adminToken) return false;
  const ok = t.length === adminToken.length && timingSafeEqual(Buffer.from(t), Buffer.from(adminToken));
  // tentativa errada gasta ficha: sem força bruta no token
  if (!ok) allow(`admin:${ipOf(req)}`, 10, 0.05);
  return ok;
}
app.addHook('onRequest', async (req, reply) => {
  if (!req.url.startsWith('/api/admin/')) return;
  reply.header('cache-control', 'private, no-store');
  const ip = ipOf(req);
  const b = buckets.get(`admin:${ip}`);
  if (b && b.tokens < 1) return reply.code(429).send({ error: 'rate' });
  if (!adminOk(req)) return reply.code(401).send({ error: 'auth' });
});

const num = (text: string, name: string) => {
  const m = new RegExp(`^${name} (\\S+)`, 'm').exec(text);
  return m ? Number(m[1]) : null;
};

async function wsWorker(url: string) {
  try {
    const [h, m] = await Promise.all([
      fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json() as Promise<Record<string, unknown>>),
      fetch(`${url}/metrics`, { signal: AbortSignal.timeout(1500) }).then((r) => r.text()),
    ]);
    return {
      url,
      ok: true,
      worker: String(h.worker ?? url),
      conns: Number(h.conns ?? 0),
      inRate: num(m, 'ws_msgs_in_per_s'),
      outRate: num(m, 'ws_msgs_out_per_s'),
      heapMb: num(m, 'ws_heap_mb'),
      blocked: num(m, 'ws_chat_blocked_total'),
      chat: num(m, 'ws_chat_in_total'),
      slowRooms: num(m, 'ws_slow_rooms'),
      aiOn: num(m, 'ws_mod_ai_enabled') === 1,
      aiCircuitOpen: num(m, 'ws_mod_ai_circuit_open') === 1,
    };
  } catch {
    return { url, ok: false };
  }
}

/** meia-noite de Brasília (UTC-3), para o total de hoje */
const brtMidnight = () => {
  const d = new Date(Date.now() - 3 * 3_600_000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + 3 * 3_600_000;
};

/** relatório interno da projeção (o poller grava a cada ciclo em var/projection.json) */
function projectionReport(): unknown {
  try {
    return JSON.parse(readFileSync(path.join(config.varDir, 'projection.json'), 'utf8'));
  } catch {
    return null;
  }
}

app.get('/api/admin/overview', async () => {
  const b = board();
  const [ws, online, acc] = await Promise.all([Promise.all(config.wsUrls.map(wsWorker)), onlineCount(), accounts.summary(12)]);
  const mem = process.memoryUsage();
  return {
    at: new Date().toISOString(),
    host: { load: os.loadavg(), cpus: os.cpus().length, memTotal: os.totalmem(), memFree: os.freemem(), uptime: os.uptime() },
    api: { rss: mem.rss, heap: mem.heapUsed, uptime: process.uptime() },
    redis: redis ? redis.status === 'ready' : null,
    ws,
    board: b
      ? { released: b.released, pst: b.br?.pst ?? null, ageS: Math.round((Date.now() - Date.parse(b.generatedAt)) / 1000), status: b.br?.status ?? null }
      : null,
    users: {
      online: online ?? ws.reduce((n, w) => n + ('conns' in w ? (w.conns ?? 0) : 0), 0),
      accounts: acc.total,
      accountsDay: acc.day,
      guesses: store.index.byId.size,
      guessesLastHour: guessPulse().lastHour,
      recent: acc.recent.map((a) => ({ username: a.username, name: a.name, email: a.email, createdAt: a.createdAt })),
    },
    superchat: { provider: pixProvider, today: superchats.totals(brtMidnight()), all: superchats.totals(0) },
    projection: projectionReport(),
  };
});

app.get('/api/admin/superchats', async () =>
  superchats.list(100).map(({ qr: _q, json: _j, ...s }) => ({ ...s, status: superchats.statusOf(s as SuperChat) })),
);

app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/admin/superchats/:id', async (req, reply) => {
  const s = superchats.byId.get(req.params.id);
  if (!s) return reply.code(404).send({ error: 'not_found' });
  const action = req.body?.action;
  if (action === 'approve') {
    // conferência manual do Pix (chave estática): o valor e o identificador batem no extrato
    if (superchats.statusOf(s) === 'expired') s.expiresAt = new Date(Date.now() + 60_000).toISOString();
    await markPaid(s, 'admin');
  } else if (action === 'hide') {
    if (s.status !== 'paid') return reply.code(409).send({ error: 'status' });
    s.status = 'hidden';
    await superchats.save(s);
    await toWs({ t: 'del', r: s.room, id: `sc-${s.id}` }, s.json ?? undefined).catch(() => {});
  } else return reply.code(400).send({ error: 'action' });
  return { ok: true, status: superchats.statusOf(s) };
});

app.get('/api/admin/site', async () => ({ ...site.cfg, superchat: !!pixProvider, provider: pixProvider }));

app.post<{ Body: Record<string, unknown> }>('/api/admin/site', async (req) => {
  site.save(cleanSite(req.body ?? {}, site.cfg), !!pixProvider);
  return { ...site.cfg, superchat: !!pixProvider, provider: pixProvider };
});

// ---------- cards PNG ----------
function sendPng(reply: FastifyReply, png: Buffer, maxAge: number) {
  return reply.header('content-type', 'image/png').header('cache-control', `public, max-age=${maxAge}, s-maxage=${maxAge}`).send(png);
}

// fila de cards cheia: a CDN e o navegador tentam de novo em instantes
app.setErrorHandler((err, _req, reply) => {
  if (err instanceof Busy) return reply.code(503).header('retry-after', '5').header('cache-control', 'no-store').send({ error: 'ocupado' });
  reply.send(err);
});

const noCands = (reply: FastifyReply) => reply.code(503).send({ error: 'sem dados de candidatos ainda' });

app.get<{ Params: { file: string }; Querystring: { f?: string } }>('/api/og/guess/:file', async (req, reply) => {
  const g = store.index.byId.get(req.params.file.replace(/\.png$/, ''));
  if (!g) return reply.code(404).send();
  const cands = candidates();
  if (!cands) return noCands(reply);
  // story 9:16, portrait 3:4, wide 16:9; sem f (ou outro valor): a prévia do link
  const fmt: Format = (POSTERS as string[]).includes(req.query.f ?? '') ? (req.query.f as Format) : 'og';
  const b = board();
  const final = b?.br?.status === 'totalizado' ? b.br : null;
  let result: { pa: number; dist: number; rank: number; total: number } | undefined;
  if (final) {
    const dist = Math.abs(g.pa - final.pa);
    result = { pa: final.pa, dist, rank: store.index.national.rank(final.pa, dist), total: store.index.national.total };
  }
  const png = await cached(
    'guess',
    [g.id, g.updatedAt, g.nick, fmt, result, cands],
    () => guessCard(fmt, { nick: g.nick, pa: g.pa, cands, result }),
    false,
  );
  return sendPng(reply, png, final ? 300 : 3600);
});

app.get('/api/og/board.png', async (_req, reply) => {
  const b = board();
  const cands = b?.candidates;
  if (!b || !cands) return noCands(reply);
  const s = b.released ? b.br : null;
  // antes do placar: o card de divulgação (o link colado no X/WhatsApp vira convite)
  if (!s) return sendPng(reply, await cached('teaser', [cands], () => teaserCard(cands)), 300);
  const title = s.status === 'totalizado' ? 'Resultado final do 2º turno' : 'Apuração do 2º turno com chat ao vivo';
  const png = await cached('board', [title, s?.pst, s?.a, s?.b, cands], () => scoreCard({ title, snap: s, cands, at: b.source.at }));
  return sendPng(reply, png, 15);
});

app.get<{ Params: { file: string } }>('/api/og/city/:file', async (req, reply) => {
  const m = municipalities().byIbge.get(req.params.file.replace(/\.png$/, ''));
  const cands = candidates();
  if (!m) return reply.code(404).send();
  if (!cands) return noCands(reply);
  const c = cityPayload(m);
  const subtitle = c.now
    ? undefined
    : c.t1
      ? `1º turno: ${cands.map((x) => `${x.short} ${fmtPct(((c.t1!.votes[x.n] ?? 0) / Math.max(1, c.t1!.valid)) * 100, 1)}%`).join(' · ')}`
      : 'Acompanhe a apuração da sua cidade';
  const png = await cached('city', [m.ibge, c.now?.pst, c.now?.a, c.now?.b, subtitle, cands], () =>
    scoreCard({ title: `${m.name} (${m.uf})`, snap: c.now, cands, subtitle, at: c.now?.at ?? null }),
  );
  return sendPng(reply, png, 30);
});

app.get<{ Params: { file: string } }>('/api/og/moment/:file', async (req, reply) => {
  const id = decodeURIComponent(req.params.file.replace(/\.png$/, ''));
  const b = board();
  const mo = b?.moments.find((x) => x.id === id);
  if (!b || !mo) return reply.code(404).send();
  const scopeSnap = mo.scope === 'br' ? b.br : (b.ufs[mo.scope] ?? null);
  const png = await cached('moment', [mo.id, mo.title], () =>
    scoreCard({ title: mo.title, snap: scopeSnap, cands: b.candidates, at: mo.at }),
  );
  return sendPng(reply, png, 86400);
});

// ---------- HTML com metas ----------
// Títulos começam pelo que as pessoas buscam ("apuração 2º turno", "resultado", o nome da cidade); a marca vai no fim.
const BRAND = config.siteName;
const versus = () => {
  const c = candidates();
  return c ? `${c[0].short} x ${c[1].short}` : 'presidente';
};
const DEFAULT_DESC =
  'Acompanhe a apuração do 2º turno ao vivo com dados oficiais do TSE e comente em tempo real no chat, com a torcida de cada lado. Resultado por estado e por cidade, e seu palpite antes das 19h.';
/** muda quando o card de compartilhamento muda: X e WhatsApp guardam a imagem pelo endereço */
const OG_VER = 'c3';

function sendHtml(reply: FastifyReply, meta: Meta) {
  return reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'public, s-maxage=30, stale-while-revalidate=60').send(renderHtml(meta));
}

const boardMeta = (p: string): Meta => {
  const b = board();
  const s = b?.released ? b.br : null;
  const c = b?.candidates;
  const desc = s && c && s.valid
    ? `${fmtPct(s.pst, 1)}% das urnas apuradas: ${c[0].short} ${fmtPct(s.pa)}% × ${fmtPct(s.pb)}% ${c[1].short}. Acompanhe ao vivo e comente no chat em tempo real. Dados oficiais do TSE.`
    : `${versus()}: ${DEFAULT_DESC.charAt(0).toLowerCase()}${DEFAULT_DESC.slice(1)}`;
  return {
    title: `Apuração do 2º turno com chat em tempo real | ${BRAND}`,
    description: desc,
    path: p,
    image: `/api/og/board.png?v=${OG_VER}-${s?.pst ?? 0}`,
    imageAlt: `Apuração do 2º turno com chat em tempo real: ${versus()}`,
    ...(p === '/'
      ? { jsonLd: { '@context': 'https://schema.org', '@type': 'WebSite', name: BRAND, url: config.publicUrl, inLanguage: 'pt-BR', description: DEFAULT_DESC } }
      : { noindex: true }),
  };
};

for (const p of ['/', '/tv', '/embed/placar']) app.get(p, async (_req, reply) => sendHtml(reply, boardMeta(p)));

// telas do app com título e descrição próprios (antes saíam com o HTML genérico, sem canonical)
const pages: Record<string, () => Omit<Meta, 'path' | 'image'>> = {
  '/painel': () => ({
    title: `Resultado do 2º turno 2026 em tempo real: ${versus()} | ${BRAND}`,
    description: 'Painel completo da apuração: votos, projeção, quanto falta apurar, viradas e comparação com o 1º turno e com 2022. Dados oficiais do TSE.',
  }),
  '/mapa': () => ({
    title: `Mapa da apuração do 2º turno 2026 por estado e cidade | ${BRAND}`,
    description: 'Quem lidera em cada estado e em cada cidade, ao vivo. Mapa da eleição presidencial com dados oficiais do TSE.',
  }),
  '/cidade': () => ({
    title: `Apuração do 2º turno na sua cidade: resultado ao vivo | ${BRAND}`,
    description: 'Busque sua cidade e acompanhe a apuração do 2º turno: parcial do município comparada com o estado, o Brasil, o 1º turno e 2022.',
  }),
  '/palpite': () => ({
    title: `Palpite do 2º turno 2026: quem vence, ${versus()}? | ${BRAND}`,
    description: 'Dê seu palpite para o resultado do 2º turno antes das 19h e veja, durante a apuração, quão perto você chegou. Gere seu card para compartilhar.',
  }),
  '/chat': () => ({
    title: `Chat ao vivo da apuração do 2º turno | ${BRAND}`,
    description: 'Comente a apuração do 2º turno em tempo real com quem está acompanhando, com a torcida de cada lado.',
  }),
  '/privacidade': () => ({ title: `Política de privacidade | ${BRAND}`, description: 'Quais dados o site trata, para quê e os seus direitos (LGPD).' }),
  '/termos': () => ({ title: `Termos de uso | ${BRAND}`, description: 'Regras de uso do site e do chat da apuração.' }),
};
for (const [p, meta] of Object.entries(pages)) {
  app.get(p, async (_req, reply) => sendHtml(reply, { ...meta(), path: p, image: `/api/og/board.png?v=${OG_VER}-${board()?.br?.pst ?? 0}` }));
}

app.get<{ Params: { uf: string } }>('/mapa/:uf', async (req, reply) => {
  const uf = req.params.uf.toUpperCase();
  if (!UFS[uf] || uf === 'ZZ') return sendHtml(reply, { ...pages['/mapa'](), path: '/mapa', image: '/api/og/board.png' });
  const s = board()?.released ? board()?.ufs[`uf:${uf}`] : null;
  return sendHtml(reply, {
    title: `Apuração ${inUf(uf)} no 2º turno 2026: resultado ao vivo | ${BRAND}`,
    description: s
      ? `${fmtPct(s.pst, 1)}% apurado ${inUf(uf)}. Resultado por cidade, quanto falta e comparação com o 1º turno e 2022.`
      : `Como ${ufName(uf)} votou no 1º turno e a apuração do 2º turno ao vivo, cidade por cidade.`,
    path: `/mapa/${uf}`,
    image: `/api/og/board.png?v=${OG_VER}-${s?.pst ?? 0}`,
  });
});

// ---------- buscadores ----------
app.get('/robots.txt', async (_req, reply) =>
  reply
    .header('content-type', 'text/plain; charset=utf-8')
    .header('cache-control', 'public, max-age=3600')
    .send(
      [
        'User-agent: *',
        'Allow: /',
        // só as rotas internas da API; /api/og (imagens dos cards) fica liberada para X, WhatsApp e Google
        'Disallow: /api/admin/',
        'Disallow: /api/auth/',
        'Disallow: /api/superchat',
        'Disallow: /api/pix/',
        'Disallow: /api/guess',
        'Disallow: /api/me',
        'Disallow: /admin',
        'Disallow: /embed',
        'Disallow: /tv',
        'Disallow: /p/',
        'Disallow: /m/',
        'Disallow: /sala/',
        '',
        `Sitemap: ${config.publicUrl}/sitemap.xml`,
        '',
      ].join('\n'),
    ),
);

// telas principais, os 27 estados e as ~5570 cidades (a busca "apuração <cidade>" é a cauda longa da noite)
let sitemapMemo: { at: number; xml: string } | null = null;
app.get('/sitemap.xml', async (_req, reply) => {
  if (!sitemapMemo || Date.now() - sitemapMemo.at > 3_600_000) {
    const today = new Date().toISOString().slice(0, 10);
    const url = (p: string, priority: string, freq = 'hourly') =>
      `<url><loc>${config.publicUrl}${p}</loc><lastmod>${today}</lastmod><changefreq>${freq}</changefreq><priority>${priority}</priority></url>`;
    const urls = [
      url('/', '1.0', 'always'),
      url('/painel', '0.9', 'always'),
      url('/mapa', '0.9', 'always'),
      url('/cidade', '0.8'),
      url('/palpite', '0.8'),
      url('/chat', '0.5'),
      ...Object.keys(UFS).filter((u) => u !== 'ZZ').map((u) => url(`/mapa/${u}`, '0.8')),
      ...municipalities()
        .list.filter((m) => m.uf !== 'ZZ')
        .map((m) => url(`/cidade/${m.uf.toLowerCase()}/${m.slug}`, '0.6')),
    ];
    sitemapMemo = {
      at: Date.now(),
      xml: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
    };
  }
  return reply.header('content-type', 'application/xml; charset=utf-8').header('cache-control', 'public, max-age=3600').send(sitemapMemo.xml);
});

app.get<{ Params: { id: string } }>('/p/:id', async (req, reply) => {
  const g = store.index.byId.get(req.params.id);
  const c = candidates();
  if (!g || !c) return sendHtml(reply, boardMeta(req.url));
  return sendHtml(reply, {
    title: `Palpite de ${g.nick}: ${c[0].short} ${fmtPct(g.pa, 1)}% × ${fmtPct(100 - g.pa, 1)}% ${c[1].short}`,
    description: 'Qual é o seu palpite para o 2º turno? Faça o seu e acompanhe a apuração ao vivo.',
    path: `/p/${g.id}`,
    image: `/api/og/guess/${g.id}.png?v=${createHash('sha1').update(g.updatedAt).digest('hex').slice(0, 8)}`,
  });
});

app.get<{ Params: { uf: string; slug: string } }>('/cidade/:uf/:slug', async (req, reply) => {
  const m = municipalities().bySlug.get(`${req.params.uf.toLowerCase()}/${req.params.slug}`);
  if (!m) return sendHtml(reply, boardMeta(req.url));
  const now = cityPayload(m).now;
  return sendHtml(reply, {
    title: `Apuração em ${m.name} (${m.uf}) no 2º turno 2026: resultado ao vivo | ${BRAND}`,
    description: now
      ? `${fmtPct(now.pst, 1)}% apurado em ${m.name}: ${versus()}. Compare com ${m.uf}, o Brasil, o 1º turno e 2022. Dados oficiais do TSE.`
      : `Resultado do 2º turno em ${m.name} (${m.uf}) ao vivo a partir das 19h de domingo, e como a cidade votou no 1º turno e em 2022.`,
    path: `/cidade/${m.uf.toLowerCase()}/${m.slug}`,
    image: `/api/og/city/${m.ibge}.png?v=${now?.pst ?? 0}`,
  });
});

app.get<{ Params: { id: string } }>('/m/:id', async (req, reply) => {
  const mo = board()?.moments.find((x) => x.id === req.params.id);
  if (!mo) return sendHtml(reply, boardMeta(req.url));
  return sendHtml(reply, {
    title: stripEmoji(mo.title),
    description: 'Momento da apuração do 2º turno. Dados oficiais do TSE.',
    path: `/m/${encodeURIComponent(mo.id)}`,
    image: `/api/og/moment/${encodeURIComponent(mo.id)}.png`,
  });
});

app.get<{ Params: { slug: string } }>('/sala/:slug', async (req, reply) =>
  sendHtml(reply, {
    title: 'Assista à apuração comigo · sala ao vivo',
    description: 'Entre na sala para acompanhar a apuração do 2º turno e conversar em tempo real.',
    path: `/sala/${encodeURIComponent(req.params.slug)}`,
    image: `/api/og/board.png?v=${OG_VER}-${board()?.br?.pst ?? 0}`,
  }),
);

app.get('/metrics', async (_req, reply) => {
  const b = board();
  const age = b ? Math.round((Date.now() - Date.parse(b.generatedAt)) / 1000) : -1;
  reply.header('content-type', 'text/plain');
  return [
    `api_guesses ${store.index.byId.size}`,
    `api_board_age_seconds ${age}`,
    `api_board_pst ${b?.br?.pst ?? 0}`,
    `api_uptime_seconds ${Math.round(process.uptime())}`,
    `api_rss_bytes ${process.memoryUsage().rss}`,
  ].join('\n');
});

await store.init();
await accounts.init();
await superchats.init();
site.publish(!!pixProvider);
app.log.info(pixProvider ? `super chat: Pix via ${pixProvider}` : 'super chat desligado (sem WOOVI_APP_ID nem PIX_KEY)');
app.log.info(`palpites carregados: ${store.index.byId.size}`);
await app.listen({ port: config.port, host: config.host });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await store.close();
    redis?.disconnect();
    process.exit(0);
  });
}
