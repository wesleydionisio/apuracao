// Conexões Redis opcionais. Sem REDIS_URL (ou com o Redis fora), tudo cai para memória/arquivo.
import { Redis } from 'ioredis';
import { config } from './config';

export interface Bus {
  cmd: Redis;
  sub: Redis;
  ready: () => boolean;
}

export function connectRedis(onMessage: (channel: string, payload: string) => void, channels: string[]): Bus | null {
  if (!config.redisUrl) return null;
  const opts = { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false };
  const cmd = new Redis(config.redisUrl, opts);
  const sub = new Redis(config.redisUrl, { ...opts, enableOfflineQueue: true });
  const log = (who: string) => (e: Error) => console.warn(`[redis:${who}]`, e.message);
  cmd.on('error', log('cmd'));
  sub.on('error', log('sub'));
  sub.on('ready', () => {
    sub.subscribe(...channels).catch(log('subscribe'));
  });
  sub.on('message', onMessage);
  return { cmd, sub, ready: () => cmd.status === 'ready' && sub.status === 'ready' };
}
