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
  const bands = [4, 3, 2, 1, 0];
  return (
    <div
      className={cn('flex min-w-0 flex-col items-center gap-1.5', compact ? 'max-w-[10rem] flex-1' : 'w-full', className)}
      aria-label="Legenda: cor de quem lidera, mais forte quanto maior a diferença"
    >
      {/* faixas flexíveis: dividem a largura disponível (nunca empurram a página em 320px) */}
      <div className="flex w-full max-w-[22rem] min-w-0 items-center gap-2">
        {!bare && <CandidateAvatar c={a} size="xs" />}
        <div className="flex min-w-0 flex-1 items-end gap-0.5">
          {bands.map((band, i) => (
            <div key={`a${band}`} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="block h-2.5 w-full rounded-[3px]" style={{ background: bandSwatch(a, band) }} />
              {!compact && <span className="num text-[11px] leading-none text-muted-foreground">{TICKS[i]}</span>}
            </div>
          ))}
          <span className="w-1 shrink-0" />
          {[...bands].reverse().map((band, i) => (
            <div key={`b${band}`} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="block h-2.5 w-full rounded-[3px]" style={{ background: bandSwatch(b, band) }} />
              {!compact && <span className="num text-[11px] leading-none text-muted-foreground">{TICKS[4 - i]}</span>}
            </div>
          ))}
        </div>
        {!bare && <CandidateAvatar c={b} size="xs" />}
      </div>
      {!compact && (
        <div className="grid w-full text-[12px] text-muted-foreground [&>*]:col-start-1 [&>*]:row-start-1">
          {[caption, ...(ghost && ghost !== caption ? [ghost] : [])].map((c, i) => (
            <p key={c} className={cn('flex flex-wrap content-start items-center justify-center gap-x-3 gap-y-1', i > 0 && 'invisible')} aria-hidden={i > 0}>
              <span>{c}</span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block size-2.5 rounded-[3px] bg-border" /> sem dados
              </span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
