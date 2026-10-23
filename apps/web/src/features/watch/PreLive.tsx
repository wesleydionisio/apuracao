// Antes das 17h: contagem regressiva, o confronto no 1º turno e o convite para o palpite.
import type { Board } from '@apuracao/shared';
import NumberFlow, { NumberFlowGroup } from '@number-flow/react';
import { Target } from 'lucide-react';
import { Link } from 'wouter';
import { CandidateAvatar } from '@/components/core/candidate';
import { SourceStamp } from '@/components/core/live';
import { Button } from '@/components/ui/button';
import { useNow } from '@/components/ui';
import { read } from '@/features/chat/rooms';
import { fmtInt } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { useHistRefs } from './data';
import { VersusBar } from './LiveScore';

const TWO = { minimumIntegerDigits: 2 } as const;
const PCT1 = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;

function Countdown({ ms, size }: { ms: number; size: 'md' | 'lg' }) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const parts = [
    ...(d ? [{ v: d, u: d === 1 ? 'dia' : 'dias', f: {} }] : []),
    { v: Math.floor((s % 86400) / 3600), u: 'h', f: TWO },
    { v: Math.floor((s % 3600) / 60), u: 'min', f: TWO },
    { v: s % 60, u: 's', f: TWO },
  ];
  return (
    <NumberFlowGroup>
      <div className={cn('display flex items-baseline gap-2.5 font-semibold', size === 'lg' ? 'text-[52px]' : 'text-[34px]')} role="timer" aria-live="off">
        {parts.map((p) => (
          <span key={p.u} className="flex items-baseline gap-0.5">
            <NumberFlow value={p.v} format={p.f} locales="pt-BR" />
            <span className={cn('font-medium tracking-normal text-muted-foreground', size === 'lg' ? 'text-[16px]' : 'text-[12px]')}>{p.u}</span>
          </span>
        ))}
      </div>
    </NumberFlowGroup>
  );
}

export function PreLive({ board, size = 'md' }: { board: Board; size?: 'md' | 'lg' }) {
  const now = useNow(1000);
  const stats = useBoard((s) => s.stats);
  const online = useBoard((s) => s.online);
  const hist = useHistRefs(board);
  const [ca, cb] = board.candidates;
  const left = Date.parse(board.releaseAt) - now;
  const mine = read('my-guess');
  const t1 = hist.t1;
  return (
    <section aria-label="Antes da apuração" className={cn(size === 'lg' ? 'p-0' : 'px-4 pt-3 pb-3')}>
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-[12.5px] text-muted-foreground">{left > 0 ? 'Placar ao vivo às 17h de domingo, em' : 'O placar abre em instantes'}</p>
        <Button asChild size="sm" className="h-8 shrink-0 rounded-full px-3 text-[12.5px]">
          <Link href={mine ? `/p/${mine}` : '/palpite'}>
            <Target className="size-3.5" aria-hidden />
            {mine ? 'Meu palpite' : 'Dar palpite'}
          </Link>
        </Button>
      </div>
      <div className="mt-1">{left > 0 ? <Countdown ms={left} size={size} /> : <span className="display text-[34px] font-semibold">17:00</span>}</div>

      <div className={cn('rounded-xl border bg-card/60 px-3 pt-2.5 pb-3', size === 'lg' ? 'mt-6' : 'mt-3')}>
        <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
          <span className="font-medium text-foreground">1º turno 2026</span>
          <span>só os dois finalistas</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          {[ca, cb].map((c, i) => (
            <div key={c.key} className={cn('flex min-w-0 items-center gap-2', i === 1 && 'flex-row-reverse text-right')}>
              <CandidateAvatar c={c} size="md" ring={t1 !== null && (i === 0 ? t1 > 50 : t1 < 50)} />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold">{c.short}</div>
                <div className="display text-[20px] leading-tight font-semibold">
                  {t1 === null ? '—' : <NumberFlow value={i === 0 ? t1 : 100 - t1} format={PCT1} locales="pt-BR" suffix="%" />}
                </div>
              </div>
            </div>
          ))}
        </div>
        <VersusBar board={board} pa={t1} marks={[]} className="mt-2.5" />
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
        <span className="num truncate">
          {stats ? (
            <>
              <span className="font-semibold text-foreground">{fmtInt(stats.guesses)}</span> palpites
            </>
          ) : (
            'Palpites abertos até 17h'
          )}
          {online ? (
            <>
              {' · '}
              <span className="font-semibold text-foreground">{fmtInt(online)}</span> aqui agora
            </>
          ) : null}
        </span>
        <SourceStamp short className="text-[11.5px]" />
      </div>
    </section>
  );
}
