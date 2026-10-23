// Identidade anônima: cookie `aid` = "<uuid>.<hmac>". Só para uso no servidor (usa node:crypto).
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const AID_COOKIE = 'aid';

const mac = (id: string, secret: string) => createHmac('sha256', secret).update(id).digest('base64url').slice(0, 22);

export function signAid(id: string, secret: string): string {
  return `${id}.${mac(id, secret)}`;
}

export function newAid(secret: string): { id: string; cookie: string } {
  const id = randomUUID();
  return { id, cookie: signAid(id, secret) };
}

/** Valida o valor do cookie e devolve o id, ou null. */
export function verifyAid(value: string | undefined | null, secret: string): string | null {
  if (!value) return null;
  const i = value.lastIndexOf('.');
  if (i <= 0) return null;
  const id = value.slice(0, i);
  const got = Buffer.from(value.slice(i + 1));
  const want = Buffer.from(mac(id, secret));
  return got.length === want.length && timingSafeEqual(got, want) ? id : null;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/** IP real atrás do Cloudflare/Caddy */
export function clientIp(headers: Record<string, string | string[] | undefined>, fallback = ''): string {
  const h = (k: string) => {
    const v = headers[k];
    return Array.isArray(v) ? v[0] : v;
  };
  return h('cf-connecting-ip') || h('x-forwarded-for')?.split(',')[0].trim() || h('x-real-ip') || fallback;
}
