// Convite para o palpite com "movimento": quantos já palpitaram (subindo ao vivo), quem acabou de palpitar,
// para que lado o Brasil está palpitando e quanto falta para fechar. Na tela Ao vivo (cartão) e no chat (faixa).
// Depois das 17h os palpites fecham: fica só o atalho para quem palpitou acompanhar a posição.
import type { Board } from '@apuracao/shared';
import { fmtPct } from '@apuracao/shared';
import NumberFlow from '@number-flow/react';
import { ChevronRight, Target, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useNow } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { fmtCountdown } from '@/components/shell/bits';
import { cn } from '@/lib/utils';
import { shortLabel, useBoard } from '@/store/board';
import { guessesOpen, myGuessId, useMyGuess } from './mine';

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return 'agora';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  return `há ${Math.round(s / 3600)} h`;
}

/** troca o palpite em destaque a cada 3s (do mais novo para o mais velho, em roda) */
function useRotating<T>(list: T[], ms = 3000) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (list.length < 2) return;
    const t = setInterval(() => setI((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [list.length, ms]);
  return list.length ? list[i % list.length] : null;
}

function Pulse() {
  return (
    <span className="relative flex size-2 shrink-0" aria-hidden>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--live)] opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-[var(--live)]" />
    </span>
  );
}

export function GuessCta({ board, className }: { board: Board; className?: string }) {
  const stats = useBoard((s) => s.stats);
  const now = useNow(1000);
  const mine = myGuessId();
  const myGuess = useMyGuess();
  const recent = [...(stats?.recentGuesses ?? [])].reverse();
  const shown = useRotating(recent);
  const [ca, cb] = board.candidates;

  if (!guessesOpen(board, now)) {
    if (!mine) return null;
    return (
      <Link
        href={`/p/${mine}`}
        className={cn('flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 transition-colors hover:bg-accent/50 active:bg-accent', className)}
      >
        <Target className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 text-[14px] font-semibold">
          Seu palpite está valendo <span className="font-medium text-muted-foreground">· veja sua posição ao vivo</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    );
  }

  const left = Date.parse(board.releaseAt) - now;
  const aWins = stats?.guessAWins ?? null;
  return (
    <section aria-label="Palpite" className={cn('overflow-hidden rounded-2xl border bg-card', className)}>
      <div className="px-4 pt-3.5 pb-4">
        <div className="flex items-center justify-between gap-3 text-[11.5px]">
          <span className="flex items-center gap-1.5 font-semibold tracking-wide text-muted-foreground uppercase">
            <Pulse />
            Palpites abertos
          </span>
          <span className="num text-muted-foreground">
            fecham às 17h · <span className="font-semibold text-foreground">{fmtCountdown(left)}</span>
          </span>
        </div>

        <p className="mt-2 text-[20px] leading-tight font-bold tracking-tight text-balance">
          {stats && stats.guesses > 0 ? (
            <>
              <NumberFlow value={stats.guesses} locales="pt-BR" className="num" /> {stats.guesses === 1 ? 'pessoa já palpitou' : 'pessoas já palpitaram'}
            </>
          ) : (
            'Dê seu palpite antes da apuração'
          )}
        </p>
        {!!stats?.guessesLastHour && (
          <p className="num mt-0.5 text-[12.5px] text-muted-foreground">
            <span className="font-semibold text-[var(--live)]">+{stats.guessesLastHour.toLocaleString('pt-BR')}</span> na última hora
          </p>
        )}

        {aWins !== null && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[12px] font-semibold">
              <span style={{ color: ca.color }}>
                {fmtPct(aWins, 0)}% acham que {shortLabel(board.candidates, 0)} vence
              </span>
              <span style={{ color: cb.color }}>{fmtPct(100 - aWins, 0)}%</span>
            </div>
            <div className="mt-1 flex h-1.5 gap-[2px] overflow-hidden rounded-full" aria-hidden>
              <div className="h-full rounded-l-full transition-[flex-basis] duration-700" style={{ flexBasis: `${aWins}%`, background: ca.color }} />
              <div className="h-full flex-1 rounded-r-full" style={{ background: cb.color }} />
            </div>
          </div>
        )}

        <div className="mt-3 flex h-5 items-center gap-1.5 overflow-hidden text-[12.5px] text-muted-foreground" aria-live="off">
          {shown && (
            <p key={`${shown.nick}${shown.at}`} className="min-w-0 truncate animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
              <span className="font-semibold text-foreground">{shown.nick}</span> palpitou{' '}
              <span className="num font-semibold" style={{ color: ca.color }}>
                {fmtPct(shown.pa, 1)}%
              </span>{' '}
              ×{' '}
              <span className="num font-semibold" style={{ color: cb.color }}>
                {fmtPct(100 - shown.pa, 1)}%
              </span>{' '}
              · {ago(shown.at, now)}
            </p>
          )}
        </div>

        {mine && (
          // já palpitou: o próprio palpite à vista (um por aparelho; o que dá é ajustar)
          <div className="mt-3 flex min-h-11 items-center justify-between gap-3 rounded-xl bg-[var(--live)]/[0.08] px-3.5 text-[13px]">
            <span className="font-semibold text-[var(--live)]">Seu palpite</span>
            {myGuess ? (
              <span className="num text-[15px] font-bold">
                <span style={{ color: ca.color }}>{fmtPct(myGuess.pa, 1)}%</span>
                <span className="mx-1.5 text-muted-foreground">×</span>
                <span style={{ color: cb.color }}>{fmtPct(100 - myGuess.pa, 1)}%</span>
              </span>
            ) : (
              <span className="h-4 w-28 animate-pulse rounded bg-muted" />
            )}
          </div>
        )}
        <Button asChild size="lg" className="mt-3 h-12 w-full rounded-xl text-[15px] font-semibold">
          <Link href={mine ? `/p/${mine}` : '/palpite'}>
            <Target className="size-4" aria-hidden />
            {mine ? 'Ver ou ajustar meu palpite' : 'Dar meu palpite'}
          </Link>
        </Button>
      </div>
    </section>
  );
}

const DISMISS = 'guess-cta-off';

/** faixa sobre o topo do chat: some ao fechar (nesta visita) ou depois de palpitar */
export function GuessStrip() {
  // só o horário de fechar: snapshot novo do placar não re-renderiza o chat
  const releaseAt = useBoard((s) => s.board?.releaseAt);
  const stats = useBoard((s) => s.stats);
  const [off, setOff] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS) === '1';
    } catch {
      return false;
    }
  });
  if (off || !releaseAt || Date.now() >= Date.parse(releaseAt) || myGuessId()) return null;
  return (
    <div className="flex items-center gap-2 border-b bg-card/95 py-1.5 pr-1.5 pl-3 text-[12.5px] backdrop-blur animate-in fade-in-0 duration-300">
      <Pulse />
      <Link href="/palpite" className="min-w-0 flex-1 truncate">
        {stats ? (
          <>
            <span className="num font-semibold">{stats.guesses.toLocaleString('pt-BR')}</span>{' '}
            <span className="text-muted-foreground">palpites até agora. E o seu?</span>
          </>
        ) : (
          <span className="text-muted-foreground">Os palpites fecham às 17h. E o seu?</span>
        )}
      </Link>
      <Button asChild size="sm" className="h-7 shrink-0 rounded-full px-3 text-[12px]">
        <Link href="/palpite">Palpitar</Link>
      </Button>
      <button
        type="button"
        onClick={() => {
          try {
            sessionStorage.setItem(DISMISS, '1');
          } catch {
            /* sem storage */
          }
          setOff(true);
        }}
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Fechar convite do palpite"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
