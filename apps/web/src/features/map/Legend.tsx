// Legenda divergente: A forte → fraco | fraco → B forte, com avatares nas pontas.
import type { CandidateDef } from '@apuracao/shared';
import { CandidateAvatar } from '@/components/core/candidate';
import { cn } from '@/lib/utils';
import { bandSwatch } from './colors';

const TICKS = ['20+', '10', '5', '2', '0'];

export function MapLegend({
  cands,
  className,
  compact = false,
  bare = false,
}: {
  cands: CandidateDef[];
  className?: string;
  compact?: boolean;
  /** sem os avatares nas pontas (quando quem está ao lado já mostra) */
  bare?: boolean;
}) {
  const [a, b] = cands;
  const bands = [4, 3, 2, 1, 0];
  return (
    <div className={cn('flex flex-col items-center gap-1.5', className)} aria-label="Legenda: cor de quem lidera, mais forte quanto maior a diferença">
      <div className="flex items-center gap-2">
        {!bare && <CandidateAvatar c={a} size="xs" />}
        <div className="flex items-end gap-0.5">
          {bands.map((band, i) => (
            <div key={`a${band}`} className="flex flex-col items-center gap-1">
              <span className={cn('block h-2.5 rounded-[3px]', compact ? 'w-3' : 'w-6')} style={{ background: bandSwatch(a, band) }} />
              {!compact && <span className="num text-[10px] leading-none text-muted-foreground">{TICKS[i]}</span>}
            </div>
          ))}
          <span className="w-1" />
          {[...bands].reverse().map((band, i) => (
            <div key={`b${band}`} className="flex flex-col items-center gap-1">
              <span className={cn('block h-2.5 rounded-[3px]', compact ? 'w-3' : 'w-6')} style={{ background: bandSwatch(b, band) }} />
              {!compact && <span className="num text-[10px] leading-none text-muted-foreground">{TICKS[4 - i]}</span>}
            </div>
          ))}
        </div>
        {!bare && <CandidateAvatar c={b} size="xs" />}
      </div>
      {!compact && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Diferença entre os dois, em pontos
          <span className="inline-flex items-center gap-1">
            · <span className="inline-block size-2.5 rounded-[3px] bg-border" /> sem dados
          </span>
        </p>
      )}
    </div>
  );
}
