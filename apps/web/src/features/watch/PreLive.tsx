// Antes das 17h: contagem regressiva e o confronto no 1º turno (o convite para o palpite é o cartão logo abaixo).
import type { Board } from '@apuracao/shared';
import NumberFlow, { NumberFlowGroup } from '@number-flow/react';
import { CandidateAvatar } from '@/components/core/candidate';
import { SourceStamp } from '@/components/core/live';
import { VersusGlow } from '@/components/core/versus';
import { useNow } from '@/components/ui';
import { fmtInt, fmtPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { flipOf, useCurve22, useHistRefs } from './data';
import { NightSpark } from './NightSpark';
import { RefChips, VersusBar } from './LiveScore';
import { useRefs } from './refs';

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
  const t1 = hist.t1;
  const curve22 = useCurve22(board, true);
  const [refs, setRefs] = useRefs();
  const flip22 = flipOf(curve22);
  return (
    <section aria-label="Antes da apuração" className={cn(size === 'lg' ? 'p-0' : 'px-4 pt-3 pb-3')}>
      {/* o convite do palpite fica no cartão logo abaixo (GuessCta): aqui só a contagem, num alinhamento só */}
      <p className="text-[11.5px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {left > 0 ? 'Placar ao vivo às 17h de domingo, em' : 'O placar abre em instantes'}
      </p>
      <div className="mt-1.5">{left > 0 ? <Countdown ms={left} size={size} /> : <span className="display text-[34px] font-semibold">17:00</span>}</div>

      <div className={cn('relative overflow-hidden rounded-xl border bg-card/60 px-3 pt-2.5 pb-3', size === 'lg' ? 'mt-6' : 'mt-3')}>
        <VersusGlow a={ca.color} b={cb.color} />
        <div className="relative flex items-center justify-between text-[11.5px] text-muted-foreground">
          <span className="font-medium text-foreground">1º turno 2026</span>
          <span>só os dois finalistas</span>
        </div>
        <div className="relative mt-2 flex items-center justify-between gap-2">
          {[ca, cb].map((c, i) => (
            <div key={c.key} className={cn('flex min-w-0 items-center gap-2', i === 1 && 'flex-row-reverse text-right')}>
              <CandidateAvatar c={c} size="md" ring={t1 !== null && (i === 0 ? t1 > 50 : t1 < 50)} priority />
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

      {/* o gráfico da noite já antes das 17h: a apuração de 2022 (tracejada), o 1º turno e onde a liderança virou */}
      <div className={size === 'lg' ? 'mt-6' : 'mt-4'}>
        <div className="mb-1 flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
          <span className="font-medium text-foreground">O que observar na apuração</span>
          {flip22 && <span className="num">virada de 2022 aos {fmtPct(flip22.pst, 1)}%</span>}
        </div>
        {/* o gráfico fica sempre; os botões só ligam/desligam as referências desenhadas nele */}
        <div className="mb-2">
          <RefChips refs={refs} set={setRefs} hist={hist} showChart={false} board={board} />
        </div>
        <NightSpark
          board={board}
          curve22={refs.y22 ? curve22 : null}
          t1={refs.t1 ? t1 : null}
          flip22={flip22}
          fullAxis
          height={size === 'lg' ? 270 : 227}
        />
      </div>

      {/* no celular a linha sai: o gráfico fica com o espaço */}
      <div className="mt-2.5 hidden items-center justify-between gap-2 text-[11.5px] text-muted-foreground lg:flex">
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
