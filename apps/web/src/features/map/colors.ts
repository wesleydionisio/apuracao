// Cor de quem lidera, nos mesmos três tons vivos que os mapas de hexágonos pintam (hex.ts), e as cores do tema
// resolvidas para o Canvas.
import type { CandidateDef } from '@apuracao/shared';
import { fmtPct } from '@apuracao/shared';
import { useEffect, useState } from 'react';
import { bandOfMargin, rgbCss, shades, toRgb } from './hex';

export const marginPts = (pa: number) => Math.abs(pa - (100 - pa));

/** A% e B% com 1 casa que sempre somam 100,0 (arredonda A e deriva B) */
export function pair(pa: number, digits = 1): [string, string] {
  const k = 10 ** digits;
  const a = Math.round(pa * k) / k;
  return [fmtPct(a, digits), fmtPct(100 - a, digits)];
}

export const leaderOf = (pa: number, cands: CandidateDef[]) => (pa >= 50 ? cands[0] : cands[1]);

const toneCache = new Map<string, string[]>();

/** cor CSS de quem lidera, no tom da vantagem (como no mapa); sem dado → a borda do tema */
export function fillFor(pa: number | null | undefined, cands: CandidateDef[]): string {
  if (pa === null || pa === undefined || Number.isNaN(pa)) return 'var(--border)';
  const c = leaderOf(pa, cands).color;
  let tones = toneCache.get(c);
  if (!tones) toneCache.set(c, (tones = shades(toRgb(c)).map(rgbCss)));
  return tones[bandOfMargin(marginPts(pa))];
}

export interface ThemeColors {
  card: string;
  muted: string;
  background: string;
  border: string;
  foreground: string;
}

const readVars = (): ThemeColors => {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return {
    card: v('--card', '#ffffff'),
    muted: v('--muted', '#eef0f3'),
    background: v('--background', '#f5f6f8'),
    border: v('--border', '#e3e6eb'),
    foreground: v('--foreground', '#0f1419'),
  };
};

/** cores do tema, atualizadas quando o data-theme muda */
export function useThemeColors(): ThemeColors {
  const [c, setC] = useState(readVars);
  useEffect(() => {
    const mo = new MutationObserver(() => setC(readVars()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return c;
}
