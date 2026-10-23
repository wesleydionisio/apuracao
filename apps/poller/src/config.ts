import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEFAULT_RELEASE_AT } from '@apuracao/shared';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const env = process.env;
const int = (v: string | undefined, d: number) => (v ? Number.parseInt(v, 10) : d);

const source = (env.SOURCE ?? 'tse') as 'tse' | 'replay';

export const config = {
  repo,
  source,
  dataDir: env.DATA_DIR ?? path.join(repo, 'public/data'),
  staticDir: env.STATIC_DIR ?? path.join(env.DATA_DIR ?? path.join(repo, 'public/data'), 'static'),
  varDir: env.VAR_DIR ?? path.join(repo, 'var'),
  manualDir: env.MANUAL_DIR ?? path.join(repo, 'var/manual'),
  redisUrl: env.REDIS_URL || '',
  databaseUrl: env.DATABASE_URL || '',
  // replay sempre "liberado": é ambiente de teste
  releaseAt: new Date(source === 'replay' && !env.RELEASE_AT ? '2000-01-01T00:00:00Z' : env.RELEASE_AT || DEFAULT_RELEASE_AT),
  tse: {
    base: env.TSE_BASE ?? 'https://resultados.tse.jus.br/oficial',
    cycle: env.TSE_CYCLE ?? 'ele2026',
    code: env.TSE_ELECTION ?? '6258',
    t1: env.TSE_T1 ?? '6257',
    timeoutMs: int(env.TSE_TIMEOUT_MS, 8000),
    concurrency: int(env.TSE_CONCURRENCY, 4),
    userAgent: env.TSE_UA ?? 'apuracao-viral/1.0 (+contato no site)',
  },
  cand: { a: env.CAND_A || undefined, b: env.CAND_B || undefined },
  colors: [env.COLOR_A || '#1f6fff', env.COLOR_B || '#f2202e'] as [string, string],
  /** cor por número de urna, ex.: "13:#f2202e,22:#1f6fff" (vence COLOR_A/B) */
  colorByNum: env.CAND_COLORS || '',
  /** fotos baixadas pelo ETL ficam em apps/web/public/cand/<n>.jpg */
  photoDir: env.PHOTO_DIR ?? path.join(repo, 'apps/web/public/cand'),
  y2022: { a: env.Y2022_A || undefined, b: env.Y2022_B || undefined },
  intervalMs: int(env.POLL_INTERVAL_MS, source === 'replay' ? 3000 : 12000),
  jitterMs: int(env.POLL_JITTER_MS, source === 'replay' ? 500 : 3000),
  /** municípios coletados (maiores por eleitorado) e quantos por ciclo */
  munLimit: int(env.MUN_LIMIT, 300),
  munBatch: int(env.MUN_BATCH, 30),
  /** com o andamento por cidade (ab da UF): máximo de cidades que mudaram buscadas por ciclo */
  munPerCycle: int(env.MUN_PER_CYCLE, 150),
  bigMunEl: int(env.BIG_MUN_EL, 300_000),
  healthPort: int(env.HEALTH_PORT, 3003),
  replay: {
    minutes: Number(env.REPLAY_MINUTES ?? 20),
    seed: int(env.REPLAY_SEED, 2026),
    /** roteiro em apps/poller/scenarios/<nome>.json, ou "aleatorio" */
    scenario: env.REPLAY_SCENARIO ?? 'domingo',
  },
};

export type Config = typeof config;
