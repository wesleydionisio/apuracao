// API: palpites, cidade, estatísticas, cards PNG e HTML com metas OG. Stateless (escala em cluster).
import { createHash } from 'node:crypto';
import path from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { Redis } from 'ioredis';
import {
  CH,
  cleanNick,
  fmtPct,
  hueOf,
  isReleased,
  KEY,
  Moderator,
  nickForId,
  type CandidateDef,
  type Municipality,
} from '@apuracao/shared';
import { AID_COOKIE, clientIp, newAid, verifyAid } from '@apuracao/shared/server';
import { config } from './config';
import { board, cityPayload, munBoard, municipalities } from './data';
import { renderHtml, type Meta } from './html';
import { cached, guessCard, scoreCard, stripEmoji, type Format } from './og';
import { FileStore, newId, PgStore, type GuessStore, type StoredGuess } from './store';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: true, bodyLimit: 4096 });
const mod = new Moderator();
const store: GuessStore = config.databaseUrl
  ? new PgStore(config.databaseUrl, path.join(config.repo, 'infra/schema.sql'))
  : new FileStore(config.varDir);
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
  const { anonId: _a, ipHash: _i, updatedAt: _u, ...pub } = g;
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

app.post<{ Body: Record<string, unknown> }>('/api/guess', async (req, reply) => {
  reply.header('cache-control', 'no-store');
  if (isReleased(new Date(), config.releaseAt)) return reply.code(403).send({ error: 'closed' });
  const ip = ipOf(req);
  if (!allow(`g:${ip}`, 5, 1 / 12)) return reply.code(429).send({ error: 'rate' });
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

async function onlineCount(): Promise<number | null> {
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

app.get('/api/stats', async (_req, reply) => {
  reply.header('cache-control', 'public, s-maxage=10, stale-while-revalidate=30');
  const byIbge = municipalities().byIbge;
  return {
    online: await onlineCount(),
    guesses: store.index.byId.size,
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
  if (!config.adminToken || req.headers['x-admin-token'] !== config.adminToken) return reply.code(401).send({ error: 'auth' });
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

// ---------- cards PNG ----------
function sendPng(reply: FastifyReply, png: Buffer, maxAge: number) {
  return reply.header('content-type', 'image/png').header('cache-control', `public, max-age=${maxAge}, s-maxage=${maxAge}`).send(png);
}

const noCands = (reply: FastifyReply) => reply.code(503).send({ error: 'sem dados de candidatos ainda' });

app.get<{ Params: { file: string }; Querystring: { f?: string } }>('/api/og/guess/:file', async (req, reply) => {
  const g = store.index.byId.get(req.params.file.replace(/\.png$/, ''));
  if (!g) return reply.code(404).send();
  const cands = candidates();
  if (!cands) return noCands(reply);
  const fmt: Format = req.query.f === 'story' ? 'story' : 'og';
  const b = board();
  const final = b?.br?.status === 'totalizado' ? b.br : null;
  let result: { pa: number; dist: number; rank: number; total: number } | undefined;
  if (final) {
    const dist = Math.abs(g.pa - final.pa);
    result = { pa: final.pa, dist, rank: store.index.national.rank(final.pa, dist), total: store.index.national.total };
  }
  const png = await cached('guess', [g.id, g.updatedAt, g.nick, fmt, result, cands], () =>
    guessCard(fmt, { nick: g.nick, pa: g.pa, cands, result }),
  );
  return sendPng(reply, png, final ? 300 : 3600);
});

app.get('/api/og/board.png', async (_req, reply) => {
  const b = board();
  const cands = b?.candidates;
  if (!b || !cands) return noCands(reply);
  const s = b.released ? b.br : null;
  const title = !s ? 'Apuração do 2º turno ao vivo a partir das 17h' : s.status === 'totalizado' ? 'Resultado final do 2º turno' : 'Apuração do 2º turno ao vivo';
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
const DEFAULT_DESC = 'Apuração do 2º turno em tempo real com dados oficiais do TSE: palpite, sua cidade, chat ao vivo e comparação com 2022.';

function sendHtml(reply: FastifyReply, meta: Meta) {
  return reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'public, s-maxage=30, stale-while-revalidate=60').send(renderHtml(meta));
}

const boardMeta = (p: string): Meta => {
  const b = board();
  const s = b?.released ? b.br : null;
  const c = b?.candidates;
  const desc = s && c && s.valid
    ? `${fmtPct(s.pst, 1)}% apurado: ${c[0].short} ${fmtPct(s.pa)}% × ${fmtPct(s.pb)}% ${c[1].short}. Dados oficiais do TSE.`
    : DEFAULT_DESC;
  return { title: `${config.siteName} · 2º turno 2026`, description: desc, path: p, image: `/api/og/board.png?v=${s?.pst ?? 0}` };
};

for (const p of ['/', '/tv', '/embed/placar']) app.get(p, async (_req, reply) => sendHtml(reply, boardMeta(p)));

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
    title: `${m.name} (${m.uf}) · apuração do 2º turno`,
    description: now ? `${fmtPct(now.pst, 1)}% apurado em ${m.name}. Compare com o 1º turno e com 2022.` : `Como ${m.name} votou no 1º turno e em 2022, e a apuração ao vivo no domingo.`,
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
    image: `/api/og/board.png?v=${board()?.br?.pst ?? 0}`,
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
