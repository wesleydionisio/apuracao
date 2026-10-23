import { fmtBrt, fmtInt, fmtPct } from '@apuracao/shared';

export { fmtInt, fmtPct };

/** 23.412.345 -> "23,4 mi"; 812.000 -> "812 mil" */
export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e4) return `${Math.round(n / 1e3).toLocaleString('pt-BR')} mil`;
  return fmtInt(n);
}

export const fmtTime = (iso?: string | null) => (iso ? fmtBrt(iso) : '—');
export const fmtHM = (iso?: string | null) => (iso ? fmtBrt(iso, { hour: '2-digit', minute: '2-digit' }) : '—');

export function signed(x: number, digits = 1) {
  return `${x > 0 ? '+' : x < 0 ? '−' : ''}${fmtPct(Math.abs(x), digits)}`;
}

export function normalizeText(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
