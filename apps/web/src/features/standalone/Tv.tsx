// /tv — tela cheia para projetar na parede ou numa live. Sempre escuro, sem chat, tudo em vw.
import type { Board, CandidateDef, Snap } from '@apuracao/shared';
import { useEffect } from 'react';
import { CandidateAvatar, useCandidateCssVars } from '@/components/core/candidate';
import { LivePill } from '@/components/core/live';
import { useNow } from '@/components/ui';
import { fmtBrt } from '@apuracao/shared';
import { fmtCompact, fmtPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { countdown, Int, momentParts, Pct, SplitBar } from './bits';

const STATUS: Record<Snap['status'], string> = {
  nao_iniciada: 'Apuração não iniciada',
  apurando: 'Em apuração',
  definido: 'Matematicamente definido',
  totalizado: 'Totalizado pelo TSE',
};
const two = (n: number) => String(n).padStart(2, '0');

export function TvPage() {
  const board = useBoard((s) => s.board);
  const link = useBoard((s) => s.link);
  const now = useNow(1000);
  useCandidateCssVars();
  useEffect(() => {
    document.title = 'Apuração ao vivo · Modo TV';
  }, []);
  return (
    <div className="dark">
      <div className="flex min-h-dvh flex-col gap-[2.4vh] overflow-hidden bg-background p-[3vw] text-foreground">
        <header className="flex items-center justify-between text-[1.5vw]">
          <div className="flex items-center gap-[1.2vw]">
            <span className="font-semibold">Apuração ao vivo</span>
            <span className="text-muted-foreground">Presidente · 2º turno</span>
            <LivePill link={link} className="text-[1.2vw] [&_span.size-2]:size-[0.8vw]" />
          </div>
          <span className="num font-medium text-muted-foreground">{fmtBrt(new Date(now), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </header>
        {!board ? (
          <div className="flex flex-1 items-center justify-center text-[2vw] text-muted-foreground">Carregando…</div>
        ) : !board.released || !board.br ? (
          <Countdown board={board} now={now} />
        ) : (
          <Live board={board} br={board.br} />
        )}
        <footer className="flex items-center justify-between gap-[2vw] border-t pt-[1.6vh] text-[1.15vw] text-muted-foreground">
          <span>
            Dados oficiais do TSE
            {board?.source.at && <span className="num"> · atualizado às {fmtBrt(board.source.at)}</span>}
          </span>
          <span>Projeto independente · {location.host}</span>
        </footer>
      </div>
    </div>
  );
}

function Countdown({ board, now }: { board: Board; now: number }) {
  const [ca, cb] = board.candidates;
  const l = countdown(Date.parse(board.releaseAt) - now);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[3vh] text-center">
      <div className="flex -space-x-[1.5vw]">
        <CandidateAvatar c={ca} size="xl" className="size-[11vw] rounded-[2.2vw] ring-[0.4vw] ring-background" />
        <CandidateAvatar c={cb} size="xl" className="size-[11vw] rounded-[2.2vw] ring-[0.4vw] ring-background" />
      </div>
      <div className="text-[2.4vw] text-muted-foreground">A apuração do 2º turno começa às 17h (Brasília)</div>
      <div className="display text-[11vw] leading-none font-semibold">
        {l.d ? `${l.d}d ` : ''}
        {two(l.h)}:{two(l.m)}:{two(l.s)}
      </div>
    </div>
  );
}

function Live({ board, br }: { board: Board; br: Snap }) {
  const [ca, cb] = board.candidates;
  const behind = br.lead === 'a' ? cb : br.lead === 'b' ? ca : null;
  return (
    <>
      <div className="flex items-end justify-between gap-[2vw]">
        <span className="text-[1.8vw] font-medium">{STATUS[br.status]}</span>
        <span className="text-[1.8vw] text-muted-foreground">
          <Pct v={br.pst} digits={2} className="font-semibold text-foreground" /> das urnas apuradas
        </span>
      </div>
      <div className="h-[0.8vh] overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-foreground transition-[width] duration-700 ease-out" style={{ width: `${br.pst}%` }} />
      </div>

      <div className="grid flex-1 grid-cols-2 items-center gap-[4vw]">
        <Side c={ca} pct={br.pa} votes={br.a} lead={br.lead === 'a'} />
        <Side c={cb} pct={br.pb} votes={br.b} lead={br.lead === 'b'} right />
      </div>

      <SplitBar pa={br.pa} ca={ca} cb={cb} className="h-[2.6vh]" />
      <div className="flex items-center justify-between text-[1.7vw]">
        <span className="text-muted-foreground">
          Diferença: <Int v={Math.abs(br.a - br.b)} className="font-semibold text-foreground" /> votos
        </span>
        {br.status === 'apurando' && behind && br.need !== null && (
          <span>
            {behind.short} precisa de{' '}
            <strong className="num font-semibold">{br.need > 100 ? 'mais de 100' : fmtPct(br.need, 1)}%</strong> do que falta
          </span>
        )}
        {br.status === 'definido' && <span className="font-medium">Os votos que faltam não permitem virada</span>}
      </div>
      <Ticker board={board} />
    </>
  );
}

function Side({ c, pct, votes, lead, right = false }: { c: CandidateDef; pct: number; votes: number; lead: boolean; right?: boolean }) {
  return (
    <div className={cn('flex items-center gap-[2vw]', right && 'flex-row-reverse text-right')}>
      <CandidateAvatar c={c} size="xl" ring={lead} className="size-[12vw] rounded-[2.4vw]" />
      <div className="min-w-0">
        <div className="flex items-center gap-[0.8vw] text-[2.6vw] font-semibold" style={{ flexDirection: right ? 'row-reverse' : 'row' }}>
          <span className="size-[1vw] rounded-full" style={{ background: c.color }} />
          {c.short}
          {c.party && <span className="text-[1.6vw] font-normal text-muted-foreground">{c.party}</span>}
        </div>
        <Pct v={pct} digits={2} className={cn('display block text-[8vw] leading-[0.95] font-semibold', !lead && 'text-muted-foreground')} />
        <div className="num text-[1.7vw] text-muted-foreground">{fmtCompact(votes)} votos</div>
      </div>
    </div>
  );
}

/** últimos momentos rolando na base da tela */
function Ticker({ board }: { board: Board }) {
  const items = board.moments.slice(0, 6);
  if (!items.length) return <div className="h-[5vh]" />;
  const row = items.map((m) => {
    const { Icon, text } = momentParts(m.title);
    return (
      <span key={m.id} className="inline-flex shrink-0 items-center gap-[0.8vw] pr-[4vw]">
        <Icon className="size-[1.6vw] text-muted-foreground" aria-hidden />
        <span className="num text-muted-foreground">{fmtBrt(m.at, { hour: '2-digit', minute: '2-digit' })}</span>
        {text}
      </span>
    );
  });
  return (
    <div className="relative h-[5vh] overflow-hidden rounded-[0.8vw] border bg-card text-[1.6vw]" aria-label="Momentos recentes">
      <style>{'@keyframes tv-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}'}</style>
      <div className="flex h-full w-max items-center whitespace-nowrap pl-[2vw] motion-safe:animate-[tv-marquee_45s_linear_infinite]">
        {row}
        {row}
      </div>
    </div>
  );
}
