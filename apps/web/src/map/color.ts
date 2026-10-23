import type { CandidateDef } from '@apuracao/shared';

/** cor do líder com intensidade pela margem (0 → clarinho, 15pp+ → cheia) */
export function marginColor(pa: number | null | undefined, cands: CandidateDef[], empty = 'var(--soft)'): string {
  if (pa === null || pa === undefined || Number.isNaN(pa)) return empty;
  const m = Math.abs(pa - 50);
  if (m < 0.05) return 'var(--muted)';
  const c = pa > 50 ? cands[0].color : cands[1].color;
  const pct = Math.round(22 + Math.min(1, m / 15) * 78);
  return `color-mix(in srgb, ${c} ${pct}%, var(--card))`;
}
