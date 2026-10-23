import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RELEASE_AT } from '@apuracao/shared';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const env = process.env;
const dataDir = path.resolve(env.DATA_DIR ?? path.join(repo, 'public/data'));

export const config = {
  repo,
  port: Number(env.PORT ?? 3001),
  host: env.HOST ?? '0.0.0.0',
  dataDir,
  staticDir: path.resolve(env.STATIC_DIR ?? path.join(dataDir, 'static')),
  varDir: path.resolve(env.VAR_DIR ?? path.join(repo, 'var')),
  webDist: path.resolve(env.WEB_DIST ?? path.join(repo, 'apps/web/dist')),
  fontsDir: path.resolve(env.FONTS_DIR ?? path.join(repo, 'apps/api/assets/fonts')),
  publicUrl: (env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  secret: env.SECRET ?? 'dev-secret',
  adminToken: env.ADMIN_TOKEN ?? '',
  redisUrl: env.REDIS_URL || '',
  databaseUrl: env.DATABASE_URL || '',
  releaseAt: new Date(env.RELEASE_AT || DEFAULT_RELEASE_AT),
  /** em dev a API também serve /data (em produção quem serve é o Caddy/CDN) */
  serveData: env.SERVE_DATA ? env.SERVE_DATA === '1' : env.NODE_ENV !== 'production',
  siteName: env.SITE_NAME ?? 'Apuração ao vivo',
};
