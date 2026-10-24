import { ChevronRight } from 'lucide-react';
import { Link } from 'wouter';
import { GuessSkeleton } from '@/components/skeletons';
import { lastReleased } from '@/lib/ghost';
import GuessPageView from '@/features/guess/GuessView';
import { GuessTicket, guessesOpen, myGuessId } from '@/features/guess/Ticket';
import { useBoard } from '@/store/board';

/** /palpite — antes das 17h o ticket; depois, "encerrados" com atalho para o ranking de quem palpitou */
export function PalpitePage() {
  const board = useBoard((s) => s.board);
  if (!board) return <GuessSkeleton released={lastReleased()} />;
  const mine = myGuessId();
  return (
    <div className="space-y-3 pt-1">
      {mine && guessesOpen(board) && (
        <Link
          href={`/p/${mine}`}
          className="flex min-h-12 items-center justify-between rounded-xl border bg-card px-4 text-[14px] font-medium transition-colors hover:bg-accent"
        >
          Ver meu palpite atual
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
      )}
      <GuessTicket board={board} />
    </div>
  );
}

export default function GuessPage() {
  return (
    <GuessPageView />
  );
}
