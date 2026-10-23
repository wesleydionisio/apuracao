import type { Board, CandidateDef } from '@apuracao/shared';
import NumberFlow, { NumberFlowGroup } from '@number-flow/react';
import { ArrowRight, Users, Vote } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { Link } from 'wouter';
import { CandidateAvatar } from '@/components/core/candidate';
import { SourceStamp } from '@/components/core/live';
import { Button } from '@/components/ui/button';
import { NightChart } from '@/features/curve';
import { CandidateRows } from '@/features/score/CandidateRows';
import { MomentsTimeline } from '@/features/score/Moments';
import { NeedMeter } from '@/features/score/NeedMeter';
import { ProjectionBand } from '@/features/score/Projection';
import { RemainingTable } from '@/features/score/Remaining';
import { StatsStrip } from '@/features/score/StatsStrip';
import { StatusBadge } from '@/features/score/status';
import { countdownParts } from '../components/chrome';
import { FlipsCard, TransferCard, useAsync } from '../components/context';
import { Card, Skeleton, Title, useNow, WhenVisible } from '../components/ui';
import { staticData } from '../lib/api';
import { fmtCompact, fmtInt, fmtPct } from '../lib/format';
import { useBoard } from '../store/board';

const MapCard = lazy(() => import('@/features/map/MapCard'));
// o formulário de palpite (Drawer, Select, Command, Slider) só existe antes das 17h: fora do bundle inicial
const GuessBlock = lazy(() =>
  import('../components/guess').then((m) => ({
    default: function GuessBlock({ board }: { board: Board }) {
      const mine = m.myGuessId();
      return (
        <>
          {mine && (
            <Button asChild variant="outline" className="mb-4 h-12 w-full justify-between rounded-xl px-4 text-[14px]">
              <Link href={`/p/${mine}`}>
                Ver meu palpite e meu card
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          )}
          <m.GuessForm board={board} />
        </>
      );
    },
  })),
);

export default function Home() {
  const board = useBoard((s) => s.board);
  const loadError = useBoard((s) => s.loadError);
  if (!board) return <Loading error={loadError} />;
  if (!board.released || !board.br) return <PreRelease board={board} />;
  return <Live board={board} />;
}

export function Loading({ error }: { error?: boolean }) {
  if (error)
    return (
      <Card className="mt-4">
        <p className="text-[14px] font-medium">Não conseguimos carregar o placar.</p>
        <p className="mt-1 text-[13px] text-muted-foreground">Tentando de novo a cada 10 segundos. Confira sua conexão.</p>
      </Card>
    );
  return (
    <div className="space-y-4 pt-2" aria-busy="true" aria-label="Carregando placar">
      <Skeleton h={14} className="w-40" />
      <Skeleton h={28} className="w-64" />
      <Skeleton h={236} />
      <Skeleton h={64} />
      <Skeleton h={64} />
    </div>
  );
}

/** o herói avisa o cabeçalho quando sai da tela (aí ele mostra o mini-placar) */
function useHeroWatch() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => useBoard.getState().set({ heroVisible: e.isIntersecting }), {
      rootMargin: '-64px 0px 0px 0px',
    });
    io.observe(el);
    return () => {
      io.disconnect();
      useBoard.getState().set({ heroVisible: false });
    };
  }, []);
  return ref;
}

function Live({ board }: { board: Board }) {
  const br = board.br!;
  const watch = useHeroWatch();
  const leader = board.candidates.find((c) => c.key === br.lead);
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-6">
      <div className="space-y-4">
        {/* herói tipo mercado */}
        <section aria-labelledby="hero-title" className="pt-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-muted-foreground">Eleições 2026 · Presidente</span>
            <StatusBadge s={br.status} short />
          </div>
          <h1 id="hero-title" className="mt-1 text-[22px] leading-tight font-semibold tracking-[-0.025em] lg:text-[26px]">
            Apuração do 2º turno
          </h1>
          <SourceStamp at={board.source.at} className="mt-1" />
          <NightChart board={board} className="mt-3" />
          <div ref={watch}>
            <CandidateRows board={board} snap={br} className="mt-3" />
          </div>
          <StatsStrip snap={br} className="mt-2" />
          {br.status === 'totalizado' && leader && (
            <p className="mt-3 rounded-xl border bg-card p-3 text-[13px] leading-relaxed">
              Totalização concluída pelo TSE: <strong style={{ color: leader.color }}>{leader.short}</strong> tem a maioria dos votos
              válidos.
            </p>
          )}
        </section>
        <NeedMeter board={board} snap={br} />
        <ProjectionBand board={board} />
        <WhenVisible h={320}>
          <Suspense fallback={<Skeleton h={320} />}>
            <MapCard />
          </Suspense>
        </WhenVisible>
        <div className="hidden space-y-4 lg:block">
          <WhenVisible h={200}>
            <TransferCard board={board} />
          </WhenVisible>
        </div>
      </div>
      <div className="mt-4 space-y-4 lg:mt-0">
        <MomentsTimeline board={board} limit={5} />
        <RemainingTable board={board} />
        <div className="lg:hidden">
          <WhenVisible h={200}>
            <TransferCard board={board} />
          </WhenVisible>
        </div>
        <WhenVisible h={140}>
          <FlipsCard board={board} />
        </WhenVisible>
        <Engagement />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ antes das 17h

function Countdown({ board }: { board: Board }) {
  const now = useNow(1000);
  const left = Date.parse(board.releaseAt) - now;
  const p = countdownParts(left);
  const cells: [number, string][] = [
    [p.d, p.d === 1 ? 'dia' : 'dias'],
    [p.h, 'horas'],
    [p.m, 'min'],
    [p.s, 'seg'],
  ];
  const when = new Date(board.releaseAt).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
  if (left <= 0)
    return <p className="mt-4 text-[15px] text-muted-foreground">Aguardando os primeiros números do TSE…</p>;
  return (
    <>
      <NumberFlowGroup>
        <div className="mt-4 grid grid-cols-4 gap-2" role="timer" aria-label={`Faltam ${p.d} dias, ${p.h} horas e ${p.m} minutos`}>
          {cells.map(([v, l]) => (
            <div key={l} className="rounded-xl border bg-card px-1 py-3 text-center">
              <div className="display text-[34px] leading-none font-semibold min-[400px]:text-[40px]">
                <NumberFlow value={v} format={{ minimumIntegerDigits: 2 }} trend={-1} />
              </div>
              <div className="mt-1.5 text-[11px] text-muted-foreground">{l}</div>
            </div>
          ))}
        </div>
      </NumberFlowGroup>
      <p className="mt-3 text-[13px] text-muted-foreground first-letter:uppercase">
        {when} (Brasília). Antes disso não mostramos placar nem projeção.
      </p>
    </>
  );
}

function PreRelease({ board }: { board: Board }) {
  const watch = useHeroWatch();
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-6">
      <div className="space-y-4">
        <section ref={watch} aria-labelledby="pre-title" className="pt-1">
          <span className="text-[12px] font-medium text-muted-foreground">Eleições 2026 · Presidente · 2º turno</span>
          <h1 id="pre-title" className="mt-1 text-[22px] leading-tight font-semibold tracking-[-0.025em] lg:text-[26px]">
            A apuração começa em
          </h1>
          <Countdown board={board} />
        </section>
        <Matchup board={board} />
        <div id="palpite">
          <Suspense fallback={<Skeleton h={420} />}>
            <GuessBlock board={board} />
          </Suspense>
        </div>
      </div>
      <div className="mt-4 space-y-4 lg:mt-0">
        <Engagement />
        <Context2022 board={board} />
      </div>
    </div>
  );
}

/** Os dois finalistas lado a lado com o resultado do 1º turno */
function Matchup({ board }: { board: Board }) {
  const { data: hist, loading } = useAsync(() => staticData.hist('t1-2026'), []);
  const [ca, cb] = board.candidates;
  if (loading) return <Skeleton h={200} />;
  const br = hist?.br;
  const side = (c: CandidateDef) => {
    const v = br?.votes[c.n] ?? 0;
    return { c, v, pct: br?.valid ? (v / br.valid) * 100 : null };
  };
  const a = side(ca);
  const b = side(cb);
  const others = br ? br.valid - a.v - b.v : 0;
  return (
    <Card className="p-0">
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 px-4 pt-5 pb-4">
        {[a, null, b].map((s, i) =>
          s === null ? (
            <span key="x" className="mt-7 text-[13px] font-medium text-muted-foreground">
              ×
            </span>
          ) : (
            <div key={s.c.key} className={i === 0 ? 'text-left' : 'flex flex-col items-end text-right'}>
              <CandidateAvatar c={s.c} size="xl" />
              <div className="mt-2.5 text-[15px] leading-tight font-semibold tracking-[-0.01em]">{s.c.short}</div>
              {s.c.party && <div className="text-[12px] text-muted-foreground">{s.c.party}</div>}
              {s.pct !== null && (
                <>
                  <div className="display mt-2 text-[24px] leading-none font-semibold" style={{ color: s.c.color }}>
                    {fmtPct(s.pct)}%
                  </div>
                  <div className="num mt-1 text-[11px] text-muted-foreground">{fmtInt(s.v)} no 1º turno</div>
                </>
              )}
            </div>
          ),
        )}
      </div>
      {br && (
        <div className="border-t px-4 py-3">
          <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full" aria-hidden>
            <div className="rounded-l-full" style={{ width: `${a.pct}%`, background: ca.color }} />
            <div className="bg-muted-foreground/40" style={{ width: `${(others / br.valid) * 100}%` }} />
            <div className="flex-1 rounded-r-full" style={{ background: cb.color }} />
          </div>
          <p className="mt-2.5 text-[12px] leading-relaxed text-muted-foreground">
            Os demais candidatos somaram <strong className="font-semibold text-foreground">{fmtCompact(others)}</strong> votos (
            {fmtPct((others / br.valid) * 100, 1)}%), brancos e nulos {fmtCompact(br.blank + br.nulls)} e a abstenção foi de{' '}
            {fmtPct((br.abst / br.el) * 100, 1)}%. É esse o estoque em disputa no 2º turno.
          </p>
        </div>
      )}
    </Card>
  );
}

function Context2022({ board }: { board: Board }) {
  const { data: y22 } = useAsync(() => staticData.hist('y2022-t2'), []);
  const br = y22?.br;
  if (!br) return null;
  const [ca, cb] = board.candidates;
  const { a: na, b: nb } = board.y2022Map;
  const va = br.votes[na] ?? 0;
  const vb = br.votes[nb] ?? 0;
  const tot = va + vb || 1;
  // em 2022 os candidatos podem ser outros: rotulamos pelo partido do lado
  const label = (c: CandidateDef, n: string) => (n === c.n && c.party ? c.party : `nº ${n}`);
  return (
    <Card>
      <Title right={<span className="text-[11px] text-muted-foreground">2º turno de 2022</span>}>Como foi da última vez</Title>
      <div className="flex items-baseline justify-between">
        <span className="display text-[22px] font-semibold" style={{ color: ca.color }}>
          {fmtPct((va / tot) * 100)}%
        </span>
        <span className="display text-[22px] font-semibold" style={{ color: cb.color }}>
          {fmtPct((vb / tot) * 100)}%
        </span>
      </div>
      <div className="mt-1 flex justify-between text-[12px] text-muted-foreground">
        <span>{label(ca, na)}</span>
        <span>{label(cb, nb)}</span>
      </div>
      <div className="mt-2 flex h-1.5 gap-[2px] overflow-hidden rounded-full" aria-hidden>
        <div className="rounded-l-full" style={{ width: `${(va / tot) * 100}%`, background: ca.color }} />
        <div className="flex-1 rounded-r-full" style={{ background: cb.color }} />
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
        Diferença de {fmtCompact(Math.abs(va - vb))} votos, a disputa mais apertada desde a redemocratização. Quem liderou o começo
        da noite perdeu: a virada só veio com cerca de dois terços das urnas apuradas.
      </p>
      <Button asChild variant="ghost" className="mt-1 -ml-3 h-11 text-[13px]">
        <Link href="/mapa">
          Ver o mapa do 1º turno
          <ArrowRight className="size-4" />
        </Link>
      </Button>
    </Card>
  );
}

function Engagement() {
  const stats = useBoard((s) => s.stats);
  const online = useBoard((s) => s.online);
  const watching = online ?? stats?.online ?? null;
  if (!stats && watching === null) return null;
  return (
    <Card>
      <dl className="grid grid-cols-2 divide-x">
        <div className="pr-3">
          <dt className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Users className="size-3.5" aria-hidden /> Online agora
          </dt>
          <dd className="display mt-1 text-[24px] font-semibold">{watching !== null ? <NumberFlow value={watching} locales="pt-BR" /> : '—'}</dd>
        </div>
        <div className="pl-4">
          <dt className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Vote className="size-3.5" aria-hidden /> Palpites feitos
          </dt>
          <dd className="display mt-1 text-[24px] font-semibold">{stats ? <NumberFlow value={stats.guesses} locales="pt-BR" /> : '—'}</dd>
        </div>
      </dl>
      {!!stats?.topCities.length && (
        <div className="mt-4 border-t pt-3">
          <h3 className="mb-1 text-[12px] font-medium text-muted-foreground">Cidades que mais palpitaram</h3>
          <ol className="divide-y">
            {stats.topCities.slice(0, 5).map((c, i) => (
              <li key={c.ibge} className="num flex min-h-10 items-center justify-between text-[13px]">
                <span className="flex items-center gap-2.5">
                  <span className="w-4 text-[11px] text-muted-foreground">{i + 1}</span>
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted-foreground">{c.uf}</span>
                </span>
                <span className="text-muted-foreground">{fmtInt(c.n)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}
