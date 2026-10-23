// Legenda divergente dos mapas de hexágonos: A forte → fraco | fraco → B forte, com avatares nas pontas.
// Os três tons são os mesmos que o mapa pinta (hex.ts): vantagem de 20+ pontos, de 6 a 20, abaixo de 6.
import type { CandidateDef } from '@apuracao/shared';
import { useMemo } from 'react';
import { CandidateAvatar } from '@/components/core/candidate';
import { cn } from '@/lib/utils';
import { HEX_BANDS, HEX_X, HEX_Y, rgbCss, shades, toRgb } from './hex';

const TICKS = [`${HEX_BANDS[0]}+`, String(HEX_BANDS[1]), '0'];

/** hexágono com vértice para cima, como no mapa */
export function HexGlyph({ color, size = 12, opacity, className }: { color: string; size?: number; opacity?: number; className?: string }) {
  const pts = HEX_X.map((x, k) => `${(x * 0.98).toFixed(3)},${(HEX_Y[k] * 0.98).toFixed(3)}`).join(' ');
  return (
    <svg viewBox="-1 -1 2 2" width={size} height={size} aria-hidden className={cn('shrink-0', className)}>
      <polygon points={pts} fill={color} opacity={opacity} />
    </svg>
  );
}

/** os três tons de cada candidato, como o mapa pinta */
export function useHexShades(cands: CandidateDef[]) {
  return useMemo(() => ({ a: shades(toRgb(cands[0].color)).map(rgbCss), b: shades(toRgb(cands[1].color)).map(rgbCss) }), [cands]);
}

export function MapLegend({
  cands,
  className,
  compact = false,
  bare = false,
  caption = 'Diferença entre os dois, em pontos',
  ghost,
}: {
  cands: CandidateDef[];
  className?: string;
  compact?: boolean;
  /** sem os avatares nas pontas (quando quem está ao lado já mostra) */
  bare?: boolean;
  caption?: string;
  /** legenda alternativa mais longa: reserva o espaço dela (trocar a legenda não empurra a página) */
  ghost?: string;
}) {
  const [a, b] = cands;
  const tones = useHexShades(cands);
  const cell = (color: string, tick: string, key: string) => (
    <div key={key} className="flex min-w-0 flex-col items-center gap-1">
      <HexGlyph color={color} size={compact ? 12 : 14} />
      {!compact && <span className="num text-[11px] leading-none text-muted-foreground">{tick}</span>}
    </div>
  );
  return (
    <div
      className={cn('flex min-w-0 flex-col items-center gap-1.5', compact ? 'flex-1' : 'w-full', className)}
      aria-label="Legenda: cor de quem lidera, mais viva quanto maior a diferença"
    >
      <div className="flex min-w-0 items-center justify-center gap-2">
        {!bare && <CandidateAvatar c={a} size="xs" />}
        <div className="flex items-end gap-1">
          {tones.a.map((c, i) => cell(c, TICKS[i], `a${i}`))}
          <span className="w-1.5 shrink-0" />
          {[...tones.b].reverse().map((c, i) => cell(c, TICKS[2 - i], `b${i}`))}
        </div>
        {!bare && <CandidateAvatar c={b} size="xs" />}
      </div>
      {!compact && (
        <div className="grid w-full text-[12px] text-muted-foreground [&>*]:col-start-1 [&>*]:row-start-1">
          {[caption, ...(ghost && ghost !== caption ? [ghost] : [])].map((c, i) => (
            <p key={c} className={cn('flex flex-wrap content-start items-center justify-center gap-x-3 gap-y-1', i > 0 && 'invisible')} aria-hidden={i > 0}>
              <span>{c}</span>
              <span className="inline-flex items-center gap-1">
                <HexGlyph color="currentColor" size={6} opacity={0.4} /> sem dados
              </span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
