// Escala divergente pela margem: cor de quem lidera, intensidade em faixas fixas de pontos.
// SVG usa color-mix (acompanha o tema sozinho); Canvas precisa de rgb resolvido em JS.
import type { CandidateDef } from '@apuracao/shared';
import { fmtPct } from '@apuracao/shared';
import { useEffect, useState } from 'react';

/** limites das faixas em pontos de margem (|pa − 50| × 2 = distância entre os dois) */
export const BANDS = [2, 5, 10, 20] as const;
/** % da cor do candidato misturada no fundo do cartão, por faixa (<2, 2–5, 5–10, 10–20, >20) */
const MIX = [26, 44, 62, 80, 100];

export const marginPts = (pa: number) => Math.abs(pa - (100 - pa));

export function bandOf(pa: number): number {
  const m = marginPts(pa);
  let i = 0;
  while (i < BANDS.length && m >= BANDS[i]) i++;
  return i;
}

/** A% e B% com 1 casa que sempre somam 100,0 (arredonda A e deriva B) */
export function pair(pa: number, digits = 1): [string, string] {
  const k = 10 ** digits;
  const a = Math.round(pa * k) / k;
  return [fmtPct(a, digits), fmtPct(100 - a, digits)];
}

export const leaderOf = (pa: number, cands: CandidateDef[]) => (pa >= 50 ? cands[0] : cands[1]);

/** cor CSS para SVG/HTML; sem dado → cinza neutro do tema (a borda: visível sobre o cartão nos dois temas) */
export function fillFor(pa: number | null | undefined, cands: CandidateDef[]): string {
  if (pa === null || pa === undefined || Number.isNaN(pa)) return 'var(--border)';
  return `color-mix(in srgb, ${leaderOf(pa, cands).color} ${MIX[bandOf(pa)]}%, var(--card))`;
}

/** rótulo sobre o preenchimento: branco nas faixas fortes, texto normal nas claras */
export const inkFor = (pa: number | null | undefined) =>
  pa === null || pa === undefined || bandOf(pa) < 2 ? 'var(--foreground)' : 'var(--on-fill)';

export function bandSwatch(c: CandidateDef, band: number) {
  return `color-mix(in srgb, ${c.color} ${MIX[band]}%, var(--card))`;
}

// ---------------------------------------------------------------- Canvas

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function mix(a: RGB, b: RGB, pct: number): string {
  const t = pct / 100;
  const c = a.map((x, i) => Math.round(x * t + b[i] * (1 - t)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
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

/** cores do tema em hex, atualizadas quando o data-theme muda */
export function useThemeColors(): ThemeColors {
  const [c, setC] = useState(readVars);
  useEffect(() => {
    const mo = new MutationObserver(() => setC(readVars()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return c;
}

/** versão de fillFor para Canvas (rgb pronto) */
export function canvasFill(pa: number | null | undefined, cands: CandidateDef[], t: ThemeColors): string {
  if (pa === null || pa === undefined || Number.isNaN(pa)) return t.border;
  return mix(hexToRgb(leaderOf(pa, cands).color), hexToRgb(t.card), MIX[bandOf(pa)]);
}
