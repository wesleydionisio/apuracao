import type { Board } from '@apuracao/shared';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { Link } from 'wouter';
import { countdownParts, LegalFooter } from '../components/chrome';
import { FlipsCard, TransferCard, useAsync } from '../components/context';
import { GuessForm, myGuessId } from '../components/guess';
import { MomentsFeed, NeedBar, ProjectionCard, Remaining, ScoreCard } from '../components/placar';
import { Card, Skeleton, Title, useNow, WhenVisible } from '../components/ui';
import { staticData } from '../lib/api';
import { fmtCompact, fmtInt, fmtPct } from '../lib/format';
import { candOf, useBoard } from '../store/board';

const Curve = lazy(() => import('../charts/Curve'));

export default function Home() {
  const board = useBoard((s) => s.board);
  const loadError = useBoard((s) => s.loadError);
  if (!board) return <Loading error={loadError} />;
  if (!board.released || !board.br) return <PreRelease board={board} />;
  return <Live board={board} />;
}

export function Loading({ error }: { error?: boolean }) {
  return (
    <div className="space-y-3">
      {error ? (
        <Card>
          <p className="text-[14px]">Não conseguimos carregar o placar. Tentando de novo…</p>
        </Card>
      ) : (
        <>
          <Skeleton h={220} />
          <Skeleton h={140} />
        </>
      )}
    </div>
  );
}

function Live({ board }: { board: Board }) {
  const br = board.br!;
  const hero = useRef<HTMLDivElement>(null);
  // enquanto o placar grande está visível, o cabeçalho mostra só a marca
  useEffect(() => {
    const el = hero.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => useBoard.getState().set({ heroVisible: e.isIntersecting }), {
      rootMargin: '-90px 0px 0px 0px',
    });
    io.observe(el);
    return () => {
      io.disconnect();
      useBoard.getState().set({ heroVisible: false });
    };
  }, []);
  return (
    <div className="space-y-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
      <div className="space-y-3">
        <div ref={hero}>
          <ScoreCard board={board} snap={br} />
        </div>
        <NeedBar board={board} snap={br} />
        <ProjectionCard board={board} />
        <WhenVisible h={280}>
          <Suspense fallback={<Skeleton h={280} />}>
            <Curve board={board} />
          </Suspense>
        </WhenVisible>
      </div>
      <div className="space-y-3">
        <MomentsFeed board={board} limit={4} />
        <Remaining board={board} />
        <WhenVisible h={160}>
          <TransferCard board={board} />
        </WhenVisible>
        <WhenVisible h={140}>
          <FlipsCard board={board} />
        </WhenVisible>
        <Engagement />
      </div>
      <div className="lg:col-span-2">
        <LegalFooter />
      </div>
    </div>
  );
}

function BigCountdown({ board }: { board: Board }) {
  const now = useNow(1000);
  const p = countdownParts(Date.parse(board.releaseAt) - now);
  const cells: [number, string][] = [
    [p.d, 'dias'],
    [p.h, 'horas'],
    [p.m, 'min'],
    [p.s, 'seg'],
  ];
  return (
    <Card className="text-center">
      <p className="text-[13px] text-muted">A apuração do 2º turno começa às 17h de domingo (Brasília)</p>
      <div className="num mt-3 grid grid-cols-4 gap-2">
        {cells.map(([v, l]) => (
          <div key={l} className="rounded-xl bg-soft py-3">
            <div className="text-[30px] font-extrabold leading-none">{String(v).padStart(2, '0')}</div>
            <div className="mt-1 text-[10px] text-muted">{l}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-muted">Antes disso não mostramos placar nem projeção. Até lá: palpite!</p>
    </Card>
  );
}

function PreRelease({ board }: { board: Board }) {
  const mine = myGuessId();
  return (
    <div className="space-y-3">
      <BigCountdown board={board} />
      {mine && (
        <Link href={`/p/${mine}`} className="flex min-h-12 items-center justify-center rounded-xl border border-line bg-card text-[14px] font-semibold">
          Ver meu palpite
        </Link>
      )}
      <GuessForm board={board} />
      <Engagement />
      <FirstRound board={board} />
      <LegalFooter />
    </div>
  );
}

/** Contexto histórico: como foi o 1º turno */
function FirstRound({ board }: { board: Board }) {
  const { data: hist, loading } = useAsync(() => staticData.hist('t1-2026'), []);
  const ca = candOf(board, 'a')!;
  const cb = candOf(board, 'b')!;
  if (loading) return <Skeleton h={120} />;
  const br = hist?.br;
  if (!br) return null;
  const a = br.votes[ca.n] ?? 0;
  const b = br.votes[cb.n] ?? 0;
  const others = br.valid - a - b;
  return (
    <Card>
      <Title>Como foi o 1º turno (4/out)</Title>
      <ul className="num space-y-2 text-[14px]">
        {[
          [ca, a],
          [cb, b],
        ].map(([c, v]) => {
          const cc = c as typeof ca;
          const pct = ((v as number) / br.valid) * 100;
          return (
            <li key={cc.key}>
              <div className="flex justify-between">
                <span className="font-semibold" style={{ color: cc.color }}>{cc.short}</span>
                <span>{fmtPct(pct)}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-soft">
                <div className="h-full" style={{ width: `${pct}%`, background: cc.color }} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[13px] text-muted">
        Os demais candidatos somaram {fmtCompact(others)} votos ({fmtPct((others / br.valid) * 100, 1)}%). Brancos e nulos:{' '}
        {fmtCompact(br.blank + br.nulls)}. Abstenção: {fmtPct((br.abst / br.el) * 100, 1)}%. Esse é o estoque em disputa no 2º turno.
      </p>
      <Link href="/mapa" className="mt-3 inline-flex min-h-11 items-center text-[14px] font-semibold underline">
        Ver o mapa do 1º turno
      </Link>
    </Card>
  );
}

function Engagement() {
  const stats = useBoard((s) => s.stats);
  const online = useBoard((s) => s.online);
  const watching = online ?? stats?.online;
  if (!stats && watching == null) return null;
  return (
    <Card>
      <div className="num grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-soft py-3">
          <div className="text-[22px] font-extrabold">{watching != null ? fmtInt(watching) : '—'}</div>
          <div className="text-[11px] text-muted">acompanhando agora</div>
        </div>
        <div className="rounded-xl bg-soft py-3">
          <div className="text-[22px] font-extrabold">{stats ? fmtInt(stats.guesses) : '—'}</div>
          <div className="text-[11px] text-muted">palpites feitos</div>
        </div>
      </div>
      {!!stats?.topCities.length && (
        <div className="mt-3">
          <h3 className="mb-1 text-[13px] font-semibold">Cidades que mais palpitaram</h3>
          <ol className="num space-y-1 text-[13px]">
            {stats.topCities.slice(0, 5).map((c, i) => (
              <li key={c.ibge} className="flex justify-between">
                <span>
                  {i + 1}. {c.name} <span className="text-muted">({c.uf})</span>
                </span>
                <span className="text-muted">{fmtInt(c.n)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}
