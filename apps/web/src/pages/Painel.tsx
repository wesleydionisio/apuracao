// /painel — a análise completa da noite, como uma página de mercado: gráfico protagonista e uma folha
// contínua de seções (divisórias, não cards). No desktop vira um dashboard 8 + 4 colunas.
import type { Board, CandidateDef, Snap } from '@apuracao/shared';
import NumberFlow, { NumberFlowGroup } from '@number-flow/react';
import { ArrowRight, CalendarClock, History, Radio, Users, Vote } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { CandidateAvatar } from '@/components/core/candidate';
import { SourceStamp } from '@/components/core/live';
import { VersusGlow } from '@/components/core/versus';
import { Button } from '@/components/ui/button';
import { NightChart } from '@/features/curve';
import { CandidateRows } from '@/features/score/CandidateRows';
import { Kpis } from '@/features/score/Kpis';
import { MomentsTimeline } from '@/features/score/Moments';
import { NeedMeter } from '@/features/score/NeedMeter';
import { ProjectionBand } from '@/features/score/Projection';
import { RefChips } from '@/features/score/RefChips';
import { activeRefs, useRefs, useRefValues } from '@/features/score/refs';
import { RemainingTable } from '@/features/score/Remaining';
import { MetaPill, Section, SectionSkeleton } from '@/features/score/Section';
import { StatusBadge } from '@/features/score/status';
import { cn } from '@/lib/utils';
import { countdownParts } from '../components/chrome';
import { FlipsCard, TransferCard, useAsync } from '../components/context';
import { Card, useNow } from '../components/ui';
import { staticData } from '../lib/api';
import { fmtCompact, fmtInt, fmtPct } from '../lib/format';
import { preBoard } from '../lib/prelive';
import { useBoard } from '../store/board';
import { Fill } from '@/components/core/bars';
import { PainelSkeleton } from '@/components/skeletons';
import { NAMES_2022 } from '../lib/y2022';

const MapCard = lazy(() => import('@/features/map/MapCard'));

export default function Painel() {
  const board = useBoard((s) => s.board);
  const loadError = useBoard((s) => s.loadError);
  if (!board) return <Loading error={loadError} />;
  // antes das 17h: o mesmo painel do ao vivo, zerado, com a contagem regressiva no topo
  if (!board.released || !board.br) return <Live board={preBoard(board)} />;
  return <Live board={board} />;
}

export function Loading({ error }: { error?: boolean }) {
  if (error)
    return (
      <Card className="mt-4">
        <p className="text-[14px] font-medium">Não foi possível carregar o placar.</p>
        <p className="mt-1 text-[13px] text-muted-foreground">Tentando de novo a cada 10 s.</p>
      </Card>
    );
  return <PainelSkeleton />;
}

function useIsDesktop() {
  const q = '(min-width: 1024px)';
  const [on, set] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const f = () => set(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return on;
}

/** as linhas dos candidatos avisam o cabeçalho quando saem da tela (aí ele mostra o mini-placar) */
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

/** monta o bloco só quando chega perto da tela; enquanto isso, um esqueleto com a forma certa */
function Deferred({ h, children }: { h: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || on) return;
    if (!('IntersectionObserver' in window)) return setOn(true);
    // rede de segurança: se o observer não disparar (aba em segundo plano, webviews), monta assim mesmo
    const t = setTimeout(() => setOn(true), 2500);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (setOn(true), io.disconnect()), { rootMargin: '400px' });
    io.observe(el);
    return () => {
      clearTimeout(t);
      io.disconnect();
    };
  }, [on]);
  return <div ref={ref}>{on ? <Suspense fallback={<SectionSkeleton h={h} />}>{children}</Suspense> : <SectionSkeleton h={h} />}</div>;
}

/** "atualizado há 8 s" — frescor do dado neste aparelho */
function Freshness() {
  const seenAt = useBoard((s) => s.seenAt);
  const now = useNow(1000);
  if (!seenAt) return null;
  const s = Math.max(0, Math.round((now - seenAt) / 1000));
  const txt = s < 5 ? 'agora' : s < 60 ? `há ${s} s` : `há ${Math.floor(s / 60)} min`;
  return (
    <span className={cn('num text-[12px]', s > 90 ? 'text-warning' : 'text-muted-foreground')} aria-live="off">
      atualizado {txt}
    </span>
  );
}

/** topo enxuto: título curto, status, barra de apuração e procedência (antes das 17h: a contagem regressiva) */
function TopBar({ board, snap }: { board: Board; snap: Snap }) {
  if (!board.released)
    return (
      <header className="pt-1 pb-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[20px] leading-tight font-semibold tracking-[-0.02em] lg:text-[24px]">Presidente, 2º turno</h1>
          <StatusBadge s="nao_iniciada" short />
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">A apuração começa em</p>
        <Countdown board={board} />
        <Button asChild className="mt-4 h-11 w-full justify-between rounded-xl px-4 text-[14px] lg:w-auto lg:gap-6">
          <Link href="/palpite">
            Fazer meu palpite antes das 17h
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </header>
    );
  return (
    <header className="pt-1 pb-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[20px] leading-tight font-semibold tracking-[-0.02em] lg:text-[24px]">Presidente, 2º turno</h1>
        <StatusBadge s={snap.status} short />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <Fill pct={snap.pst} className="rounded-full bg-foreground" />
        </div>
        <span className="display shrink-0 text-[15px] font-semibold">
          <NumberFlow value={snap.pst} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} locales="pt-BR" suffix="%" />
          <span className="ml-1 text-[12px] font-normal text-muted-foreground">das urnas</span>
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <SourceStamp at={board.source.at} />
        <Freshness />
      </div>
    </header>
  );
}

function Live({ board }: { board: Board }) {
  const br = board.br!;
  // véspera: o mesmo painel, zerado (lib/prelive), com o contexto do 1º turno e de 2022 junto
  const pre = !board.released;
  const watch = useHeroWatch();
  const desktop = useIsDesktop();
  const [refs] = useRefs();
  const values = useRefValues(board);
  const leader = board.candidates.find((c) => c.key === br.lead);

  const hero = (
    <>
      <TopBar board={board} snap={br} />
      {/* um só controle: os chips dentro do gráfico ligam as camadas e as referências nas linhas */}
      <NightChart
        board={board}
        overlays={refs}
        toolbar={<RefChips cands={board.candidates} disabled={{ t1: !values.t1, y22: !values.y22, proj: !board.projection }} />}
      />
      <div ref={watch}>
        <CandidateRows board={board} snap={br} refs={activeRefs(refs, values)} reserve className="mt-2" />
      </div>
      <Kpis board={board} snap={br} t1={values.t1?.rows.br} className="mt-2 mb-5" />
      {pre && <Matchup board={board} />}
      {br.status === 'totalizado' && leader && (
        <p className="mb-5 rounded-xl border bg-card p-3 text-[13px] leading-relaxed">
          Totalização concluída pelo TSE: <strong style={{ color: leader.color }}>{leader.short}</strong> tem a maioria dos votos válidos.
        </p>
      )}
    </>
  );
  const map = (
    <Deferred h={300}>
      <div className="border-t py-5">
        <MapCard />
      </div>
    </Deferred>
  );
  const transfer = (
    <Deferred h={260}>
      <TransferCard board={board} />
    </Deferred>
  );
  const flips = (
    <Deferred h={150}>
      <FlipsCard board={board} />
    </Deferred>
  );

  if (desktop)
    return (
      <div className="grid grid-cols-12 items-start gap-x-10">
        <div className="col-span-8">
          {hero}
          <RemainingTable board={board} limit={10} />
          {transfer}
        </div>
        {/* sem sticky: a coluna é mais alta que a tela e o fim dela ficaria inalcançável */}
        <aside className="col-span-4 pt-1" aria-label="Contexto">
          <NeedMeter board={board} snap={br} className="border-t-0 pt-0" />
          <ProjectionBand board={board} />
          {pre && <Context2022 board={board} />}
          <MomentsTimeline board={board} limit={6} />
          {flips}
          {map}
          <Engagement />
        </aside>
      </div>
    );

  return (
    <div>
      {hero}
      <NeedMeter board={board} snap={br} />
      <ProjectionBand board={board} />
      {pre && <Context2022 board={board} />}
      <RemainingTable board={board} />
      <MomentsTimeline board={board} limit={5} />
      {map}
      {transfer}
      {flips}
      <Engagement />
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
  if (left <= 0) return <p className="mt-3 text-[15px] text-muted-foreground">Aguardando os primeiros números do TSE.</p>;
  return (
    <>
      <NumberFlowGroup>
        <div
          className="mt-3 grid grid-cols-4 gap-px overflow-hidden rounded-xl border bg-border"
          role="timer"
          aria-label={`Faltam ${p.d} dias, ${p.h} horas e ${p.m} minutos`}
        >
          {cells.map(([v, l]) => (
            <div key={l} className="bg-card px-1 py-3 text-center">
              <div className="display text-[32px] leading-none font-semibold min-[400px]:text-[38px]">
                <NumberFlow value={v} format={{ minimumIntegerDigits: 2 }} trend={-1} />
              </div>
              <div className="mt-1.5 text-[11px] text-muted-foreground">{l}</div>
            </div>
          ))}
        </div>
      </NumberFlowGroup>
      <p className="mt-2.5 text-[12px] text-muted-foreground">
        {when.charAt(0).toUpperCase() + when.slice(1)} (Brasília)
      </p>
    </>
  );
}

/** Os dois finalistas lado a lado com o resultado do 1º turno */
function Matchup({ board }: { board: Board }) {
  const { data: hist, loading } = useAsync(() => staticData.hist('t1-2026'), []);
  const [ca, cb] = board.candidates;
  if (loading) return <SectionSkeleton h={230} />;
  const br = hist?.br;
  const side = (c: CandidateDef) => {
    const v = br?.votes[c.n] ?? 0;
    return { c, v, pct: br?.valid ? (v / br.valid) * 100 : null };
  };
  const a = side(ca);
  const b = side(cb);
  const others = br ? br.valid - a.v - b.v : 0;
  return (
    <Section icon={CalendarClock} title="Como chegaram aqui" meta={<MetaPill>1º turno, 4 de outubro</MetaPill>}>
      <div className="relative">
        {/* sem caixa em volta: manchas que somem antes das bordas, atrás das fotos */}
        <VersusGlow a={ca.color} b={cb.color} variant="soft" className="-inset-y-3" />
        <div className="relative grid grid-cols-[1fr_auto_1fr] items-start gap-2">
          {[a, null, b].map((s, i) =>
            s === null ? (
              <span key="x" className="mt-8 text-[13px] font-medium text-muted-foreground">
                ×
              </span>
            ) : (
              <div key={s.c.key} className={i === 0 ? 'text-left' : 'flex flex-col items-end text-right'}>
                <CandidateAvatar c={s.c} size="xl" />
                <div className="mt-2.5 text-[15px] leading-tight font-semibold tracking-[-0.01em]">{s.c.short}</div>
                {s.c.party && <div className="text-[12px] text-muted-foreground">{s.c.party}</div>}
                {s.pct !== null && (
                  <>
                    <div className="display mt-2 text-[26px] leading-none font-semibold" style={{ color: s.c.color }}>
                      {fmtPct(s.pct)}%
                    </div>
                    <div className="num mt-1 text-[11px] text-muted-foreground">{fmtInt(s.v)} votos</div>
                  </>
                )}
              </div>
            ),
          )}
        </div>
      </div>
      {br && (
        <div className="mt-4">
          <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full" aria-hidden>
            <div className="rounded-l-full" style={{ width: `${a.pct}%`, background: ca.color }} />
            <div className="bg-muted-foreground/40" style={{ width: `${(others / br.valid) * 100}%` }} />
            <div className="flex-1 rounded-r-full" style={{ background: cb.color }} />
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-xl border bg-border text-[12px]">
            {[
              ['Outros', `${fmtPct((others / br.valid) * 100, 1)}%`, `${fmtCompact(others)} votos`],
              ['Brancos/nulos', `${fmtPct(((br.blank + br.nulls) / br.turnout) * 100, 1)}%`, `${fmtCompact(br.blank + br.nulls)} votos`],
              ['Abstenção', `${fmtPct((br.abst / br.el) * 100, 1)}%`, `${fmtCompact(br.abst)} eleitores`],
            ].map(([l, v, s]) => (
              <div key={l} className="bg-card px-3 py-2.5">
                <dt className="truncate text-[11px] text-muted-foreground">{l}</dt>
                <dd className="display mt-1 text-[16px] leading-none font-semibold">{v}</dd>
                <div className="mt-1 truncate text-[11px] text-muted-foreground">{s}</div>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Section>
  );
}

function Context2022({ board, className }: { board: Board; className?: string }) {
  const { data: y22 } = useAsync(() => staticData.hist('y2022-t2'), []);
  const br = y22?.br;
  if (!br) return null;
  const [ca, cb] = board.candidates;
  const { a: na, b: nb } = board.y2022Map;
  const va = br.votes[na] ?? 0;
  const vb = br.votes[nb] ?? 0;
  const tot = va + vb || 1;
  // em 2022 os candidatos podem ser outros: rotulamos pelo partido do lado
  // em 2022 o lado pode ter sido outra pessoa (22: Jair, não Flávio): nome de quem foi e o partido
  const label = (c: CandidateDef, n: string) => [NAMES_2022[n] ?? `nº ${n}`, n === c.n ? c.party : null].filter(Boolean).join(' · ');
  return (
    <Section icon={History} title="Como foi da última vez" meta={<MetaPill>2º turno de 2022</MetaPill>} className={className}>
      <div className="flex items-baseline justify-between">
        <span className="display text-[24px] font-semibold" style={{ color: ca.color }}>
          {fmtPct((va / tot) * 100)}%
        </span>
        <span className="display text-[24px] font-semibold" style={{ color: cb.color }}>
          {fmtPct((vb / tot) * 100)}%
        </span>
      </div>
      <div className="mt-1 flex justify-between text-[12px] text-muted-foreground">
        <span>{label(ca, na)}</span>
        <span>{label(cb, nb)}</span>
      </div>
      <div className="relative mt-2 flex h-1.5 gap-[2px] overflow-hidden rounded-full" aria-hidden>
        <div className="rounded-l-full" style={{ width: `${(va / tot) * 100}%`, background: ca.color }} />
        <div className="flex-1 rounded-r-full" style={{ background: cb.color }} />
      </div>
      <p className="num mt-3 text-[12px] text-muted-foreground">
        {fmtCompact(Math.abs(va - vb))} votos de diferença · virada com ~2/3 apurado
      </p>
      <Button asChild variant="ghost" className="mt-1 -ml-3 h-11 text-[13px]">
        <Link href="/mapa">
          Ver o mapa do 1º turno
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Button>
    </Section>
  );
}

function Engagement() {
  const stats = useBoard((s) => s.stats);
  const online = useBoard((s) => s.online);
  const watching = online ?? stats?.online ?? null;
  if (!stats && watching === null) return null;
  return (
    <Section icon={Radio} title="Quem está acompanhando">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border">
        <div className="bg-card px-3 py-3">
          <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Users className="size-3.5" aria-hidden /> Online agora
          </dt>
          <dd className="display mt-1 text-[22px] leading-none font-semibold">
            {watching !== null ? <NumberFlow value={watching} locales="pt-BR" /> : '—'}
          </dd>
        </div>
        <div className="bg-card px-3 py-3">
          <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Vote className="size-3.5" aria-hidden /> Palpites feitos
          </dt>
          <dd className="display mt-1 text-[22px] leading-none font-semibold">{stats ? <NumberFlow value={stats.guesses} locales="pt-BR" /> : '—'}</dd>
        </div>
      </dl>
      {!!stats?.topCities.length && (
        <div className="mt-4">
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
    </Section>
  );
}
