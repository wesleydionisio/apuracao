// Pix do Super Chat. Três jeitos de receber, escolhidos pelo .env:
//  - woovi: Woovi (WOOVI_APP_ID; WOOVI_API aponta para o sandbox nos testes). Cobrança com QR dinâmico; o webhook
//    (e a consulta de status) confirmam sozinhos.
//  - manual: só uma chave Pix (PIX_KEY). QR estático com valor e identificador; o pagamento é conferido no painel admin.
//  - dev: fora de produção, sem nada configurado. QR de mentira e um botão "simular pagamento".
import QRCode from 'qrcode';

export type Provider = 'woovi' | 'manual' | 'dev';

export interface PixConfig {
  wooviAppId: string;
  /** https://api.woovi.com (produção) ou https://api.woovi-sandbox.com (testes) */
  wooviApi: string;
  pixKey: string;
  pixName: string;
  pixCity: string;
  publicUrl: string;
  production: boolean;
}

export const providerOf = (c: PixConfig): Provider | null =>
  c.wooviAppId ? 'woovi' : c.pixKey ? 'manual' : c.production ? null : 'dev';

export interface Charge {
  qr: string;
  /** id da cobrança na Woovi (o correlationID, que é o nosso id) */
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

// ---------- Woovi ----------
// A cobrança leva o nosso id como correlationID: o webhook e a consulta chegam nela sem tabela de-para.
interface WooviCharge {
  correlationID?: string;
  /** id do Pix (txid): é o que o pagamento de teste do sandbox usa */
  identifier?: string;
  status?: 'ACTIVE' | 'COMPLETED' | 'EXPIRED';
  value?: number;
  brCode?: string;
}

const woovi = (c: PixConfig, path: string, init?: RequestInit) =>
  fetch(`${c.wooviApi}${path}`, {
    ...init,
    // a Woovi recebe o AppID cru, sem "Bearer"
    headers: { authorization: c.wooviAppId, 'content-type': 'application/json', ...init?.headers },
    signal: AbortSignal.timeout(10_000),
  });

export async function createCharge(
  c: PixConfig,
  p: Provider,
  o: { id: string; cents: number; email: string; description: string; expiresAt: Date },
): Promise<Charge> {
  if (p === 'manual') return { qr: brCode({ key: c.pixKey, name: c.pixName, city: c.pixCity, cents: o.cents, txid: o.id }), pid: null };
  if (p === 'dev') return { qr: brCode({ key: 'teste@exemplo.com', name: 'TESTE', city: 'SAO PAULO', cents: o.cents, txid: o.id }), pid: null };
  const r = await woovi(c, '/api/v1/charge', {
    method: 'POST',
    body: JSON.stringify({
      correlationID: o.id,
      value: o.cents,
      comment: o.description,
      expiresIn: Math.max(60, Math.round((o.expiresAt.getTime() - Date.now()) / 1000)),
    }),
  });
  const d = (await r.json().catch(() => null)) as { charge?: WooviCharge } | null;
  const qr = d?.charge?.brCode;
  if (!r.ok || !qr) throw new Error(`woovi ${r.status}: ${JSON.stringify(d)?.slice(0, 300)}`);
  return { qr, pid: o.id };
}

export const wooviSandbox = (c: PixConfig) => c.wooviApi.includes('sandbox');

/** só no sandbox: paga a cobrança com a conta de teste da Woovi (dispara o webhook como um pagamento de verdade) */
export async function simulateWooviPayment(c: PixConfig, pid: string): Promise<boolean> {
  if (!wooviSandbox(c)) return false;
  const r = await woovi(c, `/api/v1/charge/${encodeURIComponent(pid)}`);
  const id = r.ok ? ((await r.json()) as { charge?: WooviCharge }).charge?.identifier : undefined;
  if (!id) return false;
  const t = await woovi(c, `/openpix/testing?transactionID=${encodeURIComponent(id)}`);
  return t.ok;
}

/** consulta a cobrança na Woovi (a fonte da verdade: o webhook só avisa que algo mudou) */
export async function fetchPayment(c: PixConfig, pid: string): Promise<{ approved: boolean; ref: string | null; cents: number } | null> {
  const r = await woovi(c, `/api/v1/charge/${encodeURIComponent(pid)}`);
  if (!r.ok) return null;
  const ch = ((await r.json()) as { charge?: WooviCharge }).charge;
  return ch ? { approved: ch.status === 'COMPLETED', ref: ch.correlationID ?? null, cents: ch.value ?? 0 } : null;
}
