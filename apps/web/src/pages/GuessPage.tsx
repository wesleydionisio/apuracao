import type { Board } from '@apuracao/shared';
import { fmtPct, ufName } from '@apuracao/shared';
import { CircleCheck, ChevronRight } from 'lucide-react';
import { Link } from 'wouter';
import { GuessSkeleton } from '@/components/skeletons';
import { lastReleased } from '@/lib/ghost';
import GuessPageView from '@/features/guess/GuessView';
import { useMyGuess } from '@/features/guess/mine';
import { GuessTicket, guessesOpen, myGuessId } from '@/features/guess/Ticket';
import { useBoard } from '@/store/board';

/** /palpite — antes das 17h o ticket; depois, "encerrados" com atalho para o ranking de quem palpitou */
export function PalpitePage() {
  const board = useBoard((s) => s.board);
  if (!board) return <GuessSkeleton released={lastReleased()} />;
  const mine = myGuessId();
  return (
    <div className="space-y-3 pt-1">
      {mine && guessesOpen(board) && <MyGuessCard board={board} id={mine} />}
      <GuessTicket board={board} />
    </div>
  );
}

/** "Você já palpitou": o palpite atual em destaque, para ninguém achar que ainda falta palpitar */
function MyGuessCard({ board, id }: { board: Board; id: string }) {
  const g = useMyGuess();
  const [ca, cb] = board.candidates;
  return (
    <section className="rounded-2xl border border-[var(--live)]/40 bg-[var(--live)]/[0.06] p-4" aria-label="Seu palpite">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--live)]">
        <CircleCheck className="size-4" aria-hidden />
        Você já palpitou
      </div>
      <div className="mt-2 flex min-h-9 items-baseline gap-2 text-[26px] leading-none font-bold tracking-tight">
        {g ? (
          <>
            <span className="num" style={{ color: ca.color }}>
              {fmtPct(g.pa, 1)}%
            </span>
            <span className="text-[18px] text-muted-foreground">×</span>
            <span className="num" style={{ color: cb.color }}>
              {fmtPct(100 - g.pa, 1)}%
            </span>
          </>
        ) : (
          <span className="h-7 w-48 animate-pulse rounded-md bg-muted" />
        )}
      </div>
      <p className="mt-1 min-h-5 text-[13px] text-muted-foreground">
        {ca.short} × {cb.short}
        {g?.uf && g.ufPa != null ? ` · ${ufName(g.uf)}: ${fmtPct(g.ufPa, 1)}%` : ''}
        {g?.mun && g.munPa != null ? ` · sua cidade: ${fmtPct(g.munPa, 1)}%` : ''}
      </p>
      <Link
        href={`/p/${id}`}
        className="mt-3 flex min-h-11 items-center justify-between rounded-xl border bg-card px-4 text-[14px] font-medium transition-colors hover:bg-accent"
      >
        Ver meu card e compartilhar
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </Link>
    </section>
  );
}

export default function GuessPage() {
  return (
    <GuessPageView />
  );
}
