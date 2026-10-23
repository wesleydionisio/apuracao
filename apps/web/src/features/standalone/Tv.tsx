// /tv — tela cheia para projetar na parede ou numa live. Sempre escuro, sem chat, tudo em vw.
import type { Board, CandidateDef, Snap } from '@apuracao/shared';
import { useEffect } from 'react';
import { NightChart } from '@/features/curve';
import { CandidateAvatar, useCandidateCssVars } from '@/components/core/candidate';
import { LivePill } from '@/components/core/live';
import { useNow } from '@/components/ui';
import { fmtBrt } from '@apuracao/shared';
import { fmtCompact, fmtPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { countdown, momentParts, Pct, SplitBar } from './bits';
import { Fill } from '@/components/core/bars';

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
    <div data-theme="dark">
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
        <CandidateAvatar c={ca} size="xl" priority className="size-[11vw] rounded-[2.2vw] ring-[0.4vw] ring-background" />
        <CandidateAvatar c={cb} size="xl" priority className="size-[11vw] rounded-[2.2vw] ring-[0.4vw] ring-background" />
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
  const rows = [
    { c: ca, pct: br.pa, votes: br.a, lead: br.lead === 'a' },
    { c: cb, pct: br.pb, votes: br.b, lead: br.lead === 'b' },
  ].sort((x, y) => y.pct - x.pct);
  // o gráfico usa px fixos (rótulos de 10–19px): na TV ele é ampliado como um todo
  // a coluna do gráfico tem ~38% da largura: o zoom mantém ~340px internos, a largura para a qual ele foi desenhado
  const zoom = Math.max(1, Math.min(2.4, window.innerWidth / 900));
  return (
    <>
      <div className="flex items-center gap-[1.6vw]">
        <span className="text-[1.6vw] font-medium">{STATUS[br.status]}</span>
        <div className="h-[0.9vh] flex-1 overflow-hidden rounded-full bg-muted">
          <Fill pct={br.pst} className="rounded-full bg-foreground" />
        </div>
        <span className="text-[1.6vw] text-muted-foreground">
          <Pct v={br.pst} digits={2} className="font-semibold text-foreground" /> das urnas
        </span>
      </div>

      <div className="grid flex-1 grid-cols-[7fr_5fr] items-center gap-[3vw]">
        <div className="flex flex-col gap-[3.2vh]">
          {rows.map((r) => (
            <Side key={r.c.key} {...r} />
          ))}
          <SplitBar pa={br.pa} ca={ca} cb={cb} className="h-[2.2vh]" />
        </div>
        <div className="flex min-w-0 flex-col gap-[2vh]">
          <div className="rounded-[1vw] border bg-card p-[1.2vw]">
            <div style={{ zoom }}>
              <NightChart board={board} modes={['hoje']} height={Math.round((window.innerHeight * 0.36) / zoom)} />
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-[1vw] border bg-border">
            <TvStat label="Diferença" value={fmtCompact(Math.abs(br.a - br.b))} />
            <TvStat
              label={behind ? `${behind.short.split(' ')[0]} precisa` : 'Precisa'}
              value={br.status !== 'apurando' || br.need === null ? '—' : br.need > 100 ? '>100%' : `${fmtPct(br.need, 1)}%`}
            />
            <TvStat label="A apurar" value={br.rem > 0 ? `~${fmtCompact(br.rem)}` : '—'} />
          </dl>
          {br.status === 'definido' && <p className="text-[1.5vw] font-medium">Os votos que faltam não permitem virada</p>}
        </div>
      </div>
      <Ticker board={board} />
    </>
  );
}

function TvStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-card px-[1vw] py-[1.4vh]">
      <dt className="truncate text-[1.1vw] text-muted-foreground">{label}</dt>
      <dd className="display mt-[0.4vh] truncate text-[2vw] leading-none font-semibold">{value}</dd>
    </div>
  );
}

function Side({ c, pct, votes, lead }: { c: CandidateDef; pct: number; votes: number; lead: boolean }) {
  return (
    <div className="flex items-center gap-[1.8vw]">
      <CandidateAvatar c={c} size="xl" ring={lead} priority className="size-[9vw] rounded-[1.8vw]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[2.3vw] leading-tight font-semibold">{c.short}</div>
        <div className="num mt-[0.3vh] flex items-baseline gap-[0.8vw] text-[1.4vw] text-muted-foreground">
          {lead && (
            <span className="font-semibold" style={{ color: c.color }}>
              À frente
            </span>
          )}
          {c.party && <span>{c.party}</span>}
          <span>{fmtCompact(votes)} votos</span>
        </div>
      </div>
      <Pct v={pct} digits={2} className={cn('display block text-[7vw] leading-[0.9] font-semibold', !lead && 'text-muted-foreground')} />
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
