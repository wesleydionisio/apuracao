// Pix do Super Chat. Três jeitos de receber, escolhidos pelo .env:
//  - mp: Mercado Pago (MP_ACCESS_TOKEN). Cobrança com QR dinâmico; o webhook (e a consulta de status) confirmam sozinhos.
//  - manual: só uma chave Pix (PIX_KEY). QR estático com valor e identificador; o pagamento é conferido no painel admin.
//  - dev: fora de produção, sem nada configurado. QR de mentira e um botão "simular pagamento".
import { createHmac, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';

export type Provider = 'mp' | 'manual' | 'dev';

export interface PixConfig {
  mpAccessToken: string;
  mpWebhookSecret: string;
  pixKey: string;
  pixName: string;
  pixCity: string;
  publicUrl: string;
  production: boolean;
}

export const providerOf = (c: PixConfig): Provider | null =>
  c.mpAccessToken ? 'mp' : c.pixKey ? 'manual' : c.production ? null : 'dev';

export interface Charge {
  qr: string;
  /** id da cobrança no Mercado Pago */
  pid: string | null;
}

// ---------- BR Code (EMV) para Pix estático ----------
const field = (id: string, v: string) => `${id}${String(v.length).padStart(2, '0')}${v}`;

function crc16(s: string): string {
  let crc = 0xffff;
  for (const ch of Buffer.from(s, 'utf8')) {
    crc ^= ch << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** nome/cidade do recebedor: só ASCII maiúsculo, no tamanho que o padrão aceita */
const ascii = (s: string, max: number) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, '').trim().toUpperCase().slice(0, max) || 'NA';

export function brCode(o: { key: string; name: string; city: string; cents: number; txid: string }): string {
  const payload =
    field('00', '01') +
    field('26', field('00', 'br.gov.bcb.pix') + field('01', o.key)) +
    field('52', '0000') +
    field('53', '986') +
    field('54', (o.cents / 100).toFixed(2)) +
    field('58', 'BR') +
    field('59', ascii(o.name, 25)) +
    field('60', ascii(o.city, 15)) +
    field('62', field('05', o.txid.replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***')) +
    '6304';
  return payload + crc16(payload);
}

export const qrPng = (qr: string) => QRCode.toDataURL(qr, { margin: 1, width: 320, errorCorrectionLevel: 'M' });

// ---------- Mercado Pago ----------
const MP = 'https://api.mercadopago.com/v1/payments';

export async function createCharge(
  c: PixConfig,
  p: Provider,
  o: { id: string; cents: number; email: string; description: string; expiresAt: Date },
): Promise<Charge> {
  if (p === 'manual') return { qr: brCode({ key: c.pixKey, name: c.pixName, city: c.pixCity, cents: o.cents, txid: o.id }), pid: null };
  if (p === 'dev') return { qr: brCode({ key: 'teste@exemplo.com', name: 'TESTE', city: 'SAO PAULO', cents: o.cents, txid: o.id }), pid: null };
  const r = await fetch(MP, {
    method: 'POST',
    headers: { authorization: `Bearer ${c.mpAccessToken}`, 'content-type': 'application/json', 'x-idempotency-key': o.id },
    body: JSON.stringify({
      transaction_amount: o.cents / 100,
      description: o.description,
      payment_method_id: 'pix',
      payer: { email: o.email },
      external_reference: o.id,
      date_of_expiration: o.expiresAt.toISOString().replace('Z', '-00:00'),
      // o Mercado Pago só aceita URL pública com https
      ...(c.publicUrl.startsWith('https') ? { notification_url: `${c.publicUrl}/api/pix/webhook` } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const d = (await r.json().catch(() => null)) as MpPayment | null;
  const qr = d?.point_of_interaction?.transaction_data?.qr_code;
  if (!r.ok || !qr || !d?.id) throw new Error(`mercado pago ${r.status}: ${JSON.stringify(d)?.slice(0, 300)}`);
  return { qr, pid: String(d.id) };
}

interface MpPayment {
  id?: number;
  status?: string;
  transaction_amount?: number;
  external_reference?: string;
  point_of_interaction?: { transaction_data?: { qr_code?: string } };
}

/** consulta a cobrança no Mercado Pago (a fonte da verdade: o webhook só avisa que algo mudou) */
export async function fetchPayment(c: PixConfig, pid: string): Promise<{ approved: boolean; ref: string | null; cents: number } | null> {
  const r = await fetch(`${MP}/${encodeURIComponent(pid)}`, {
    headers: { authorization: `Bearer ${c.mpAccessToken}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  const d = (await r.json()) as MpPayment;
  return { approved: d.status === 'approved', ref: d.external_reference ?? null, cents: Math.round((d.transaction_amount ?? 0) * 100) };
}

/**
 * Assinatura do webhook (x-signature: "ts=...,v1=..."), quando MP_WEBHOOK_SECRET está definido.
 * Mesmo sem ela o pagamento só vale depois de consultado na API do Mercado Pago.
 */
export function webhookSignatureOk(c: PixConfig, headers: Record<string, unknown>, dataId: string): boolean {
  if (!c.mpWebhookSecret) return true;
  const sig = String(headers['x-signature'] ?? '');
  const reqId = String(headers['x-request-id'] ?? '');
  const parts = Object.fromEntries(sig.split(',').map((kv) => kv.trim().split('=') as [string, string]));
  if (!parts.ts || !parts.v1) return false;
  const manifest = `id:${dataId.toLowerCase()};request-id:${reqId};ts:${parts.ts};`;
  const want = createHmac('sha256', c.mpWebhookSecret).update(manifest).digest('hex');
  return want.length === parts.v1.length && timingSafeEqual(Buffer.from(want), Buffer.from(parts.v1));
}
