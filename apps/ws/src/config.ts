import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { releaseAt } from '@apuracao/shared';

const env = process.env;
const int = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export const config = {
  port: int(env.PORT, 3002),
  host: env.HOST || '0.0.0.0',
  secret: env.SECRET || 'dev-secret',
  redisUrl: env.REDIS_URL || '',
  dataDir: env.DATA_DIR || fileURLToPath(new URL('../../../public/data', import.meta.url)),
  releaseAt: releaseAt(env.RELEASE_AT),
  workerId: env.WORKER_ID || `${hostname()}-${process.pid}`,
  /** confia em cf-connecting-ip / x-forwarded-for (atrás de Cloudflare + Caddy) */
  trustProxy: env.TRUST_PROXY !== '0',
  ipConnLimit: int(env.IP_CONN_LIMIT, 30),
  maxRoomsPerConn: int(env.MAX_ROOMS, 4),
  /** mensagens por sessão: rajada e reposição por segundo */
  userBurst: int(env.USER_BURST, 3),
  userRefill: Number(env.USER_REFILL || 0.5),
  /** mensagens por IP (CGNAT de celular: muita gente atrás do mesmo IP) */
  ipBurst: int(env.IP_BURST, 20),
  ipRefill: Number(env.IP_REFILL || 2),
  reactBurst: int(env.REACT_BURST, 10),
  reactRefill: Number(env.REACT_REFILL || 5),
  /** slow mode liga quando a sala passa de N msgs/s (média de 5s) */
  slowTrigger: Number(env.SLOW_TRIGGER || 5),
  slowSeconds: int(env.SLOW_SECONDS, 5),
  reportsToDelete: int(env.REPORTS_TO_DELETE, 3),
  historySize: 200,
  blockedTerms: (env.BLOCKED_TERMS || '').split(',').map((s) => s.trim()).filter(Boolean),
  blockedFile: env.BLOCKED_FILE || '',
  filePollMs: int(env.FILE_POLL_MS, 2000),
  /** moderação por modelo de decisão (OpenRouter). Sem chave: só o filtro local. */
  mod: {
    apiKey: env.OPENROUTER_API_KEY || '',
    model: env.MOD_MODEL || 'inception/mercury-decide:free',
    endpoint: env.MOD_ENDPOINT || 'https://openrouter.ai/api/alpha/decisions',
    /** junta mensagens desta janela numa única chamada */
    batchMs: int(env.MOD_BATCH_MS, 200),
    maxBatch: int(env.MOD_MAX_BATCH, 16),
    concurrency: int(env.MOD_CONCURRENCY, 4),
    timeoutMs: int(env.MOD_TIMEOUT_MS, 3000),
    /** bloqueia quando P(aceitável) < limiar */
    threshold: Number(env.MOD_THRESHOLD || 0.5),
  },
};
