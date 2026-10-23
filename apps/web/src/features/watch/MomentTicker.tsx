// Letreiro fino com o momento mais recente da apuração; toca e abre o momento (compartilhável).
import type { Board } from '@apuracao/shared';
import { ChevronRight } from 'lucide-react';
import { Link } from 'wouter';
import { momentParts } from '@/features/chat/moment';
import { fmtHM } from '@/lib/format';
import { cn } from '@/lib/utils';

export function MomentTicker({ board, className }: { board: Board; className?: string }) {
  const m = board.released ? board.moments[0] : undefined;
  if (!m) return null;
  const { Icon, kind, text } = momentParts(m.title);
  return (
    <Link
      href={`/m/${encodeURIComponent(m.id)}`}
      className={cn('flex h-9 items-center gap-2 border-t px-4 text-[12.5px] transition-colors hover:bg-accent/50', className)}
      aria-label={`Último momento: ${text}. Abrir`}
    >
      <span key={m.id} className="flex min-w-0 flex-1 items-center gap-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
          <Icon className="size-3" aria-hidden />
        </span>
        <span className="shrink-0 font-semibold">{kind}</span>
        <span className="min-w-0 truncate text-muted-foreground">{text}</span>
      </span>
      <span className="num shrink-0 text-[11px] text-muted-foreground">{fmtHM(m.at)}</span>
      <ChevronRight className="-mr-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
