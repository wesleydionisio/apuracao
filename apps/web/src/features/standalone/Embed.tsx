// /embed/placar — iframe compacto (~140px) para portais e lives. ?tema=claro|escuro força o tema.
import { ArrowUpRight } from 'lucide-react';
import { useEffect } from 'react';
import { CandidateAvatar, useCandidateCssVars } from '@/components/core/candidate';
import { SourceStamp } from '@/components/core/live';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { Pct, SplitBar } from './bits';

export function EmbedPage() {
  const board = useBoard((s) => s.board);
  useCandidateCssVars();
  useEffect(() => {
    const t = new URLSearchParams(location.search).get('tema');
    if (t === 'claro' || t === 'escuro') document.documentElement.classList.toggle('dark', t === 'escuro');
    document.body.style.background = 'transparent';
  }, []);
  const site = location.origin;
  return (
    <div className="p-2">
      <div className="rounded-xl border bg-card px-3.5 pt-3 pb-2.5 text-card-foreground">
        {!board ? (
          <div className="h-[86px] animate-pulse rounded-lg bg-muted" />
        ) : !board.released || !board.br ? (
          <div className="flex h-[86px] items-center gap-3">
            <span className="flex -space-x-2">
              {board.candidates.map((c) => (
                <CandidateAvatar key={c.key} c={c} size="md" className="ring-2 ring-card" />
              ))}
            </span>
            <p className="text-[14px] leading-snug">
              A apuração do 2º turno começa às <strong>17h</strong> (Brasília).
            </p>
          </div>
        ) : (
          <EmbedScore />
        )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <SourceStamp at={board?.source.at} className="text-[11px]" />
          <a href={site} target="_blank" rel="noopener" className="inline-flex items-center gap-0.5 text-[11px] font-medium hover:underline">
            ao vivo em {location.host}
            <ArrowUpRight className="size-3" aria-hidden />
          </a>
        </div>
      </div>
    </div>
  );
}

function EmbedScore() {
  const board = useBoard((s) => s.board)!;
  const br = board.br!;
  const [ca, cb] = board.candidates;
  return (
    <>
      <div className="flex items-center gap-2.5">
        <CandidateAvatar c={ca} size="md" ring={br.lead === 'a'} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium">{ca.short}</div>
          <Pct v={br.pa} digits={2} className={cn('display block text-[24px] leading-none font-semibold', br.lead !== 'a' && 'text-muted-foreground')} />
        </div>
        <div className="shrink-0 text-center text-[11px] leading-tight text-muted-foreground">
          <Pct v={br.pst} digits={1} className="block text-[13px] font-semibold text-foreground" />
          apurado
        </div>
        <div className="min-w-0 flex-1 text-right">
          <div className="truncate text-[12px] font-medium">{cb.short}</div>
          <Pct v={br.pb} digits={2} className={cn('display block text-[24px] leading-none font-semibold', br.lead !== 'b' && 'text-muted-foreground')} />
        </div>
        <CandidateAvatar c={cb} size="md" ring={br.lead === 'b'} />
      </div>
      <SplitBar pa={br.pa} ca={ca} cb={cb} className="mt-2.5 h-1.5" />
    </>
  );
}
