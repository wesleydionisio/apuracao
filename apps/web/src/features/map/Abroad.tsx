// O exterior no mapa: uma linha discreta abaixo do Brasil, com todos os países somados (o placar do TSE já conta
// esses votos no total). Tocar abre o painel do exterior, com o mapa-múndi por cidade.
import type { CandidateDef } from '@apuracao/shared';
import { ChevronRight, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { pair } from './colors';
import type { UfValue } from './data';

export function AbroadRow({ value, cands, onPick, className }: { value: UfValue | undefined; cands: CandidateDef[]; onPick: () => void; className?: string }) {
  const pa = value?.pa ?? null;
  const [a, b] = pa != null ? pair(pa) : [null, null];
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn('press flex min-h-11 w-full items-center gap-2.5 border-y px-1 py-2 text-left text-xs text-muted-foreground', className)}
      aria-label={pa != null ? `Exterior, todos os países somados: ${cands[0].short} ${a}%, ${cands[1].short} ${b}%` : 'Exterior, todos os países somados'}
    >
      <Globe className="size-4 shrink-0" aria-hidden />
      <span className="font-medium text-foreground">Exterior</span>
      <span className="min-w-0 truncate">todos os países</span>
      {pa != null ? (
        <span className="num ml-auto flex shrink-0 items-baseline gap-1.5 font-semibold">
          <span style={{ color: cands[0].color }}>{a}%</span>
          <span className="text-border" aria-hidden>
            |
          </span>
          <span style={{ color: cands[1].color }}>{b}%</span>
        </span>
      ) : (
        <span className="ml-auto shrink-0">sem dados</span>
      )}
      <ChevronRight className="size-4 shrink-0" aria-hidden />
    </button>
  );
}
