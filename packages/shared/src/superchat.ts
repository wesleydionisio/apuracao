// Super Chat (pago com Pix): faixas de valor no estilo do YouTube. A faixa decide a cor, quanto tempo a
// mensagem fica fixada no topo do chat e o tamanho máximo do texto. Valores sempre em centavos.

export interface ScTier {
  /** a partir de quantos centavos */
  min: number;
  /** cor do cabeçalho do cartão (o corpo usa a mesma cor mais clara) */
  color: string;
  /** texto sobre a cor */
  ink: '#ffffff' | '#0f1419';
  /** segundos fixado no topo do chat (0 = só no fluxo) */
  pin: number;
  /** caracteres de mensagem */
  chars: number;
}

export const SC_TIERS: ScTier[] = [
  { min: 500, color: '#1565c0', ink: '#ffffff', pin: 0, chars: 60 },
  { min: 1000, color: '#00b8d4', ink: '#0f1419', pin: 2 * 60, chars: 120 },
  { min: 2000, color: '#1de9b6', ink: '#0f1419', pin: 5 * 60, chars: 160 },
  { min: 5000, color: '#ffca28', ink: '#0f1419', pin: 10 * 60, chars: 200 },
  { min: 10000, color: '#f57c00', ink: '#ffffff', pin: 30 * 60, chars: 240 },
  { min: 20000, color: '#d81b60', ink: '#ffffff', pin: 60 * 60, chars: 240 },
  { min: 50000, color: '#d50000', ink: '#ffffff', pin: 2 * 3600, chars: 240 },
];

/** atalhos de valor na tela de compra */
export const SC_PRESETS = [500, 1000, 2000, 5000, 10000, 20000];
export const SC_MIN = SC_TIERS[0].min;
export const SC_MAX = 100_000;
/** o Pix gerado vale por este tempo */
export const SC_PIX_TTL_MS = 30 * 60_000;

export function scTier(cents: number): ScTier {
  let t = SC_TIERS[0];
  for (const x of SC_TIERS) if (cents >= x.min) t = x;
  return t;
}

/** 1000 -> "R$ 10"; 1050 -> "R$ 10,50" */
export function fmtBrl(cents: number): string {
  const v = cents / 100;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: Number.isInteger(v) ? 0 : 2 });
}

export type ScStatus = 'pending' | 'paid' | 'expired' | 'hidden';

/** o que a pessoa que comprou vê enquanto paga (GET /api/superchat/:id) */
export interface ScCharge {
  id: string;
  status: ScStatus;
  amount: number;
  /** Pix copia e cola */
  qr: string;
  /** QR em data URL (PNG) */
  qrPng: string;
  expiresAt: string;
  /** quem confere o pagamento: Woovi (automático), manual (no painel) ou dev (botão de teste) */
  provider: 'woovi' | 'manual' | 'dev';
  /** Woovi em modo de teste: a tela mostra "simular pagamento" (paga com a conta de teste do sandbox) */
  sandbox?: true;
}

/** /data/site.json: o que o front precisa saber do site, editado no painel admin */
export interface SiteConfig {
  sponsor: { on: boolean; name: string; text: string; url: string; image: string };
  /** sem patrocinador: "anuncie aqui" leva para este WhatsApp */
  ad: { whatsapp: string; text: string };
  /** há um meio de receber o Pix configurado */
  superchat: boolean;
}

export const DEFAULT_SITE: SiteConfig = {
  sponsor: { on: false, name: '', text: '', url: '', image: '' },
  ad: { whatsapp: '', text: 'Anuncie aqui durante a apuração' },
  superchat: false,
};

/** link do WhatsApp com a mensagem pronta */
export function waLink(phone: string, text = 'Olá! Quero anunciar no site da apuração.'): string {
  const d = phone.replace(/\D/g, '');
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}?text=${encodeURIComponent(text)}`;
}
