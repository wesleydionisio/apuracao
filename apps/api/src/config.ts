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
  /** login com o Google no chat (Client ID web do Google Cloud). Vazio = só o login de teste em dev */
  googleClientId: env.GOOGLE_CLIENT_ID ?? '',
  siteName: env.SITE_NAME ?? 'Urna.digi',
  production: env.NODE_ENV === 'production',
  /** Super Chat: Mercado Pago (automático) ou só uma chave Pix (conferência manual no painel) */
  pix: {
    mpAccessToken: env.MP_ACCESS_TOKEN ?? '',
    mpWebhookSecret: env.MP_WEBHOOK_SECRET ?? '',
    pixKey: env.PIX_KEY ?? '',
    pixName: env.PIX_NAME ?? 'Urna Digital',
    pixCity: env.PIX_CITY ?? 'Sao Paulo',
    publicUrl: (env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
    production: env.NODE_ENV === 'production',
  },
  /** sem Redis (dev), a API entrega Super Chats ao WS por HTTP */
  wsInternal: (env.WS_INTERNAL_URL ?? 'http://127.0.0.1:3002').replace(/\/$/, ''),
  /** workers WS para o painel admin (saúde e métricas) */
  wsUrls: (env.WS_URLS ?? 'http://127.0.0.1:3002').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
  /** WhatsApp do "anuncie aqui" (o painel admin pode trocar) */
  adWhatsapp: env.AD_WHATSAPP ?? '',
  blockedTerms: (env.BLOCKED_TERMS || '').split(',').map((s) => s.trim()).filter(Boolean),
  blockedFile: env.BLOCKED_FILE || '',
};
