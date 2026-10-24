// "Onde estão os palpites": distribuição de todos os palpites (faixas de 0,5 ponto) com marcadores
// do seu palpite e do parcial ao vivo. Dado de /api/guesses/hist; no modo demo, uma distribuição sintética.
import type { CandidateDef } from '@apuracao/shared';
import { fmtPct } from '@apuracao/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CandidateAvatar } from '@/components/core/candidate';
import { getJSON, HttpError } from '@/lib/api';
import { poll } from '@/lib/poll';
import { MOCK } from '@/lib/env';
import { fmtInt } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface GuessHist {
  bins: { pa: number; n: number }[];
  total: number;
}

const STEP = 0.5;
const LO = 30;
const HI = 70;

function mockHist(): GuessHist {
  // normal em torno de 49 com caudas: só para o modo demo
  const bins: GuessHist['bins'] = [];
  let total = 0;
  for (let pa = LO; pa < HI; pa += STEP) {
    const z = (pa + STEP / 2 - 49) / 3.4;
    const n = Math.round(4200 * Math.exp(-0.5 * z * z) + (pa % 5 === 0 ? 900 : 0));
    bins.push({ pa, n });
    total += n;
  }
  return { bins, total };
}

/** carrega a distribuição e atualiza a cada minuto; `null` se a rota não existir (API antiga) */
export function useGuessHist(): GuessHist | null {
  const [h, setH] = useState<GuessHist | null>(MOCK ? mockHist() : null);
  useEffect(() => {
    if (MOCK) return;
    let alive = true;
    let gone = false;
    const load = async () => {
      if (gone) return;
      await getJSON<GuessHist>('/api/guesses/hist')
        .then((x) => alive && setH(x))
        .catch((e) => {
          if (e instanceof HttpError && e.status === 404) gone = true;
        });
    };
    const stop = poll(load, 60_000);
    return () => {
      alive = false;
      stop();
    };
  }, []);
  return h;
}

const W = 320;
const H = 88;
const X = (pa: number) => ((pa - LO) / (HI - LO)) * W;

export function GuessHistogram({
  hist,
  ca,
  cb,
  mine,
  live,
  className,
}: {
  hist: GuessHist;
  ca: CandidateDef;
  cb: CandidateDef;
  /** % de A no palpite da pessoa (marcador "você") */
  mine?: number | null;
  /** parcial ao vivo de A (marcador tracejado) */
  live?: number | null;
  className?: string;
}) {
  const stats = useMemo(() => {
    let max = 1;
    let aWins = 0;
    let below = 0;
    let acc = 0;
    let median: number | null = null;
    for (const b of hist.bins) {
      max = Math.max(max, b.n);
      if (b.pa >= 50) aWins += b.n;
      if (mine != null && b.pa + STEP <= mine) below += b.n;
    }
    for (const b of hist.bins) {
      acc += b.n;
      if (median === null && acc >= hist.total / 2) median = b.pa + STEP / 2;
    }
    return { max, aWins: hist.total ? (aWins / hist.total) * 100 : 0, below: hist.total ? (below / hist.total) * 100 : 0, median };
  }, [hist, mine]);

  const bw = W / hist.bins.length;
  const mineBin = mine != null ? Math.floor((mine - LO) / STEP) : -1;
  // barra sob o mouse (ou tocada): mostra a faixa e quantos palpites caíram nela
  const [hot, setHot] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const binAt = (clientX: number) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return null;
    const i = Math.floor((((clientX - r.left) / r.width) * W) / bw);
    return i >= 0 && i < hist.bins.length ? i : null;
  };
  const hb = hot !== null ? hist.bins[hot] : null;

  return (
    <figure className={cn('relative w-full', className)}>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H + 16}`}
        className="block h-auto w-full cursor-crosshair touch-pan-y overflow-visible"
        role="img"
        aria-label={`Distribuição de ${fmtInt(hist.total)} palpites. ${fmtPct(stats.aWins, 0)}% apostam em ${ca.short}.`}
        onPointerMove={(e) => e.pointerType === 'mouse' && setHot(binAt(e.clientX))}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return;
          const i = binAt(e.clientX);
          setHot((cur) => (cur === i ? null : i));
        }}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setHot(null)}
      >
        {hist.bins.map((b, i) => {
          const h = b.n ? Math.max(1.5, (b.n / stats.max) * (H - 4)) : 0;
          const c = b.pa + STEP / 2 > 50 ? ca.color : cb.color;
          const isMine = i === mineBin;
          const dim = hot !== null ? (i === hot ? 1 : 0.35) : isMine ? 1 : mine != null ? 0.6 : 0.8;
          return <rect key={b.pa} x={i * bw + 0.5} y={H - h} width={Math.max(1, bw - 1)} height={h} rx={1} fill={c} opacity={dim} />;
        })}
        {/* área inteira capta o ponteiro, inclusive onde não há barra */}
        <rect x={0} y={0} width={W} height={H} fill="transparent" />
        {/* linha dos 50% */}
        <line x1={X(50)} x2={X(50)} y1={0} y2={H} stroke="var(--foreground)" strokeOpacity={0.25} strokeDasharray="2 3" />
        {live != null && live >= LO && live <= HI && (
          <g>
            <line x1={X(live)} x2={X(live)} y1={-2} y2={H} stroke="var(--foreground)" strokeWidth={1.5} strokeDasharray="3 2" />
            <text x={X(live)} y={-6} textAnchor="middle" className="fill-muted-foreground text-[11px]">
              parcial
            </text>
          </g>
        )}
        {mine != null && (
          <g className="transition-transform duration-150 ease-out" style={{ transform: `translateX(${X(Math.max(LO, Math.min(HI, mine)))}px)` }}>
            <line x1={0} x2={0} y1={4} y2={H} stroke="var(--foreground)" strokeWidth={2} />
            <circle cx={0} cy={4} r={3.5} fill="var(--foreground)" />
          </g>
        )}
        {[35, 40, 45, 50, 55, 60, 65].map((t) => (
          <text key={t} x={X(t)} y={H + 12} textAnchor="middle" className="num fill-muted-foreground text-[11px]">
            {t}
          </text>
        ))}
      </svg>
      {hb && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-[calc(100%+6px)] rounded-lg border bg-popover px-2.5 py-1.5 text-[12px] whitespace-nowrap shadow-lg"
          style={{ left: `clamp(70px, ${((hot! + 0.5) / hist.bins.length) * 100}%, calc(100% - 70px))` }}
          role="tooltip"
        >
          <div className="num font-semibold">
            {fmtInt(hb.n)} {hb.n === 1 ? 'palpite' : 'palpites'}
          </div>
          <div className="num text-muted-foreground">
            {ca.short.split(' ')[0]} {fmtPct(hb.pa, 1)}–{fmtPct(hb.pa + STEP, 1)}%
          </div>
        </div>
      )}
      {/* o eixo é o % de A: à esquerda dos 50% quem vence é B — dito com todas as letras */}
      <div className="mt-1 flex items-center justify-between text-[11px] font-medium">
        <span className="inline-flex items-center gap-1.5" style={{ color: cb.color }}>
          <span aria-hidden>←</span>
          <CandidateAvatar c={cb} size="xs" />
          {cb.short} vence
        </span>
        <span className="inline-flex items-center gap-1.5" style={{ color: ca.color }}>
          {ca.short} vence
          <CandidateAvatar c={ca} size="xs" />
          <span aria-hidden>→</span>
        </span>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-2.5 text-[11px] text-muted-foreground">
        <span className="num">
          <span className="font-semibold text-foreground">{fmtInt(hist.total)}</span> palpites
          {stats.median != null && (
            <>
              {' '}
              · mediana <span className="font-medium text-foreground">{fmtPct(stats.median, 1)}%</span> {ca.short}
            </>
          )}
        </span>
        <span className="num">
          <span className="font-medium" style={{ color: ca.color }}>
            {fmtPct(stats.aWins, 0)}%
          </span>{' '}
          × <span className="font-medium" style={{ color: cb.color }}>{fmtPct(100 - stats.aWins, 0)}%</span> apostam na vitória
        </span>
        {mine != null && hist.total >= 10 && (
          <span className="num w-full">
            Seu palpite dá a {ca.short} mais do que {fmtPct(stats.below, 0)}% das pessoas.
          </span>
        )}
      </figcaption>
    </figure>
  );
}
