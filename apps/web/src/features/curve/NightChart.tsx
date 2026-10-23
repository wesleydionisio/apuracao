// Gráfico protagonista da noite (estilo Polymarket): % dos válidos de cada candidato × % de urnas apuradas.
// SVG próprio (sem lib de gráficos): rótulos no fim das linhas, ponto ao vivo, scrub por toque, camada de 2022.
import type { Board, CandidateDef } from '@apuracao/shared';
import NumberFlow from '@number-flow/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CandidateAvatar } from '@/components/core/candidate';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { staticData } from '@/lib/api';
import { fmtPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import { monotonePath, nearest, separate, yDomain, type XY } from './geometry';

type C22 = Awaited<ReturnType<typeof staticData.curve2022>>;
interface Pt {
  x: number;
  a: number;
  b: number;
  src?: string;
}

const PAD = { l: 8, r: 40, t: 14, b: 26 };
const LABEL_H = 40;
const PCT2 = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function useCurve2022() {
  const [c22, set] = useState<C22>(null);
  useEffect(() => {
    let alive = true;
    staticData
      .curve2022()
      .then((c) => alive && set(c))
      .catch(() => alive && set(null));
    return () => {
      alive = false;
    };
  }, []);
  return c22;
}

export default function NightChart({ board, className }: { board: Board; className?: string }) {
  const [ca, cb] = board.candidates;
  const [mode, setMode] = useState<'hoje' | '2022'>('hoje');
  const c22 = useCurve2022();
  const [wrap, width] = useWidth<HTMLDivElement>();
  const height = width >= 640 ? 300 : 236;
  const [probe, setProbe] = useState<number | null>(null);

  const now: Pt[] = useMemo(() => {
    const pts = board.curve.filter((p) => p.pst > 0 && p.pa > 0);
    // as primeiras urnas oscilam muito: com amostra suficiente, descarta o ruído inicial
    const top = pts.length ? pts[pts.length - 1].pst : 0;
    const clean = top > 3 ? pts.filter((p) => p.pst >= 0.5) : pts;
    return clean.map((p) => ({ x: p.pst, a: p.pa, b: 100 - p.pa }));
  }, [board.curve]);
  const past: Pt[] = useMemo(() => {
    if (!c22) return [];
    const { a: na, b: nb } = board.y2022Map;
    return c22.points
      .filter((p) => p.pct[na] !== undefined)
      .map((p) => ({ x: p.pst, a: p.pct[na], b: p.pct[nb] ?? 100 - p.pct[na], src: (p as { src?: string }).src }));
  }, [c22, board.y2022Map]);
  const show22 = mode === '2022' && past.length > 1;
  // último cruzamento das linhas em 2022 (a virada da noite)
  const flip22 = useMemo(() => {
    let at: number | null = null;
    for (let i = 1; i < past.length; i++) {
      const d0 = past[i - 1].a - past[i - 1].b;
      const d1 = past[i].a - past[i].b;
      if (d0 !== 0 && Math.sign(d0) !== Math.sign(d1)) at = past[i - 1].x + ((past[i].x - past[i - 1].x) * Math.abs(d0)) / (Math.abs(d0) + Math.abs(d1));
    }
    return at;
  }, [past]);

  const pst = board.br?.pst ?? 0;
  const last = now[now.length - 1];
  const dom = useMemo(() => yDomain([...now.map((p) => p.a), ...(show22 ? past.map((p) => p.a) : [])]), [now, past, show22]);

  // "Hoje": o eixo x acompanha a apuração (a linha ocupa a largura); "× 2022": 0–100% para ver a noite inteira
  // a ponta da linha fica em ~45–50% da largura, deixando uma pista à direita para os rótulos
  const xMax = show22 ? 100 : Math.min(100, Math.max(10, Math.ceil(pst / 0.5 / 5) * 5));
  const xTicks = xMax === 100 ? [0, 25, 50, 75, 100] : [0, xMax / 2, xMax].map((v) => Math.round(v * 10) / 10);
  const iw = Math.max(0, width - PAD.l - PAD.r);
  const ih = height - PAD.t - PAD.b;
  const sx = (x: number) => PAD.l + (Math.min(x, xMax) / xMax) * iw;
  const sy = (y: number) => PAD.t + ((dom.hi - y) / (dom.hi - dom.lo)) * ih;
  const line = (pts: Pt[], k: 'a' | 'b') => monotonePath(pts.map((p) => [sx(p.x), sy(p[k])] as XY));

  // rótulos do fim da linha (HTML sobre o SVG)
  const labels = useMemo(() => {
    if (!last || !width) return null;
    const ex = sx(last.x);
    const right = ex + 12 + 124 <= PAD.l + iw;
    let ya0 = sy(last.a);
    let yb0 = sy(last.b);
    if (!right) {
      // à esquerda da ponta: o rótulo sai de cima da própria linha (o de cima sobe, o de baixo desce)
      const off = LABEL_H / 2 + 6;
      if (ya0 <= yb0) {
        ya0 -= off;
        yb0 += off;
      } else {
        ya0 += off;
        yb0 -= off;
      }
    }
    const [ya, yb] = separate(ya0, yb0, LABEL_H, PAD.t + LABEL_H / 2 - 6, PAD.t + ih - LABEL_H / 2 + 6);
    return { ex, ya, yb, right };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last, width, dom, ih, iw, xMax]);

  const pNow = probe !== null ? nearest(now, probe, 6) : null;
  const pPast = probe !== null && show22 ? nearest(past, probe, 8) : null;

  const onPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' || e.buttons || e.type === 'pointerdown') {
      const r = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - r.left - PAD.l) / Math.max(1, iw)) * xMax;
      setProbe(Math.max(0, Math.min(xMax, x)));
    }
  };

  const ariaSummary = last
    ? `${ca.short} ${fmtPct(last.a, 1)}%, ${cb.short} ${fmtPct(last.b, 1)}% com ${fmtPct(pst, 1)}% das urnas apuradas`
    : 'Aguardando as primeiras urnas';

  return (
    <figure className={cn('select-none', className)}>
      <div ref={wrap} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} className="absolute inset-0 overflow-visible" role="img" aria-label={`Curva da noite: ${ariaSummary}`}>
            <defs>
              <pattern id="falta" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--border)" strokeWidth="2" />
              </pattern>
            </defs>
            {/* o que ainda falta apurar */}
            {pst < 99.5 && (
              <g>
                <rect x={sx(pst)} y={PAD.t} width={Math.max(0, sx(xMax) - sx(pst))} height={ih} fill="url(#falta)" opacity={0.6} />
                {sx(xMax) - sx(pst) > 70 && (
                  <text x={(sx(pst) + sx(xMax)) / 2} y={PAD.t + ih - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                    a apurar
                  </text>
                )}
              </g>
            )}
            {/* grade à direita */}
            {dom.ticks.map((v) => (
              <g key={v}>
                <line
                  x1={PAD.l}
                  x2={PAD.l + iw}
                  y1={sy(v)}
                  y2={sy(v)}
                  stroke="var(--border)"
                  strokeDasharray={v === 50 ? undefined : '2 4'}
                  strokeWidth={v === 50 ? 1.25 : 1}
                />
                <text x={PAD.l + iw + 8} y={sy(v) + 3.5} className={cn('num text-[10px]', v === 50 ? 'fill-foreground font-medium' : 'fill-muted-foreground')}>
                  {v}%
                </text>
              </g>
            ))}
            {/* eixo x: % de urnas apuradas */}
            {xTicks.map((v, i) => (
              <text
                key={v}
                x={sx(v)}
                y={height - 8}
                textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
                className="num fill-muted-foreground text-[10px]"
              >
                {v.toLocaleString('pt-BR')}%{i === xTicks.length - 1 && xMax < 100 ? ' apurado' : ''}
              </text>
            ))}
            {show22 && (
              <g opacity={0.55}>
                <path d={line(past, 'a')} fill="none" stroke={ca.color} strokeWidth={1.5} strokeDasharray="4 4" />
                <path d={line(past, 'b')} fill="none" stroke={cb.color} strokeWidth={1.5} strokeDasharray="4 4" />
                {past
                  .filter((p) => p.src === 'fonte')
                  .map((p) => (
                    <circle key={p.x} cx={sx(p.x)} cy={sy(p.a)} r={2.5} fill="var(--background)" stroke={ca.color} strokeWidth={1.25} />
                  ))}
              </g>
            )}
            {now.length > 1 && (
              <g strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={probe !== null ? 0.9 : 1}>
                <path d={line(now, 'b')} stroke={cb.color} strokeWidth={2.25} />
                <path d={line(now, 'a')} stroke={ca.color} strokeWidth={2.25} />
              </g>
            )}
            {last && (
              <g>
                {(['a', 'b'] as const).map((k) => {
                  const c = k === 'a' ? ca : cb;
                  const cx = sx(last.x);
                  const cy = sy(last[k]);
                  return (
                    <g key={k}>
                      <circle cx={cx} cy={cy} r={4} fill={c.color} className="live-ping" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
                      <circle cx={cx} cy={cy} r={4} fill={c.color} stroke="var(--background)" strokeWidth={2} />
                    </g>
                  );
                })}
              </g>
            )}
            {/* scrub */}
            {probe !== null && (
              <g>
                <line x1={sx(pNow?.x ?? probe)} x2={sx(pNow?.x ?? probe)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--foreground)" strokeOpacity={0.3} />
                {pNow &&
                  (['a', 'b'] as const).map((k) => (
                    <circle key={k} cx={sx(pNow.x)} cy={sy(pNow[k])} r={4} fill={(k === 'a' ? ca : cb).color} stroke="var(--background)" strokeWidth={2} />
                  ))}
              </g>
            )}
          </svg>
        )}

        {/* rótulos no fim das linhas */}
        {labels && (
          <div className={cn('pointer-events-none absolute inset-0 transition-opacity duration-200', probe !== null && 'opacity-25')} aria-hidden>
            {(
              [
                [ca, last!.a, labels.ya],
                [cb, last!.b, labels.yb],
              ] as [CandidateDef, number, number][]
            ).map(([c, v, y]) => (
              <div
                key={c.key}
                className={cn('absolute flex items-center gap-1.5', !labels.right && 'flex-row-reverse text-right')}
                style={{
                  top: y - LABEL_H / 2,
                  height: LABEL_H,
                  ...(labels.right ? { left: labels.ex + 12 } : { right: width - labels.ex + 12 }),
                }}
              >
                <CandidateAvatar c={c} size="xs" />
                <div className="leading-none">
                  <div className="max-w-24 truncate text-[11px] font-medium text-muted-foreground">{c.short}</div>
                  <div className="display mt-0.5 text-[19px] font-semibold" style={{ color: c.color }}>
                    <NumberFlow value={v} format={PCT2} locales="pt-BR" suffix="%" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* tooltip do scrub */}
        {probe !== null && (pNow || pPast) && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border bg-popover/95 px-2.5 py-2 text-[12px] shadow-lg backdrop-blur"
            style={{
              left: Math.min(Math.max(0, sx((pNow ?? pPast)!.x) - 72), Math.max(0, width - 150)),
            }}
          >
            <div className="num mb-1 flex justify-between gap-3 text-[11px] text-muted-foreground">
              <span>{fmtPct((pNow ?? pPast)!.x, 1)}% apurado</span>
              {show22 && (
                <span className="flex gap-3">
                  <span className="w-11 text-right">hoje</span>
                  <span className="w-9 text-right">2022</span>
                </span>
              )}
            </div>
            {[ca, cb].map((c) => (
              <div key={c.key} className="num flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: c.color }} />
                  <span className="truncate">{c.short.split(' ')[0]}</span>
                </span>
                <span className="flex gap-3">
                  <span className="w-11 text-right font-semibold">{pNow ? `${fmtPct(c.key === 'a' ? pNow.a : pNow.b, show22 ? 1 : 2)}%` : '—'}</span>
                  {show22 && (
                    <span className="w-9 text-right text-muted-foreground">{pPast ? fmtPct(c.key === 'a' ? pPast.a : pPast.b, 1) : '—'}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* camada de captura: arrasto horizontal faz scrub, vertical rola a página */}
        <div
          className="absolute inset-0 touch-pan-y"
          onPointerDown={onPointer}
          onPointerMove={onPointer}
          onPointerLeave={() => setProbe(null)}
          onPointerCancel={() => setProbe(null)}
          onPointerUp={(e) => e.pointerType !== 'mouse' && setTimeout(() => setProbe(null), 1600)}
        />

        {now.length < 2 && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[13px] text-muted-foreground">
            A curva aparece com as primeiras urnas apuradas
          </div>
        )}
      </div>

      <figcaption className="mt-2 flex items-center justify-between gap-3">
        <span className="text-[11px] leading-tight text-muted-foreground">
          {show22 ? (
            <>
              <span className="mr-1 inline-block w-3 border-t border-dashed border-muted-foreground align-middle" />
              2022 · reconstrução aproximada
            </>
          ) : (
            '% dos votos válidos × % das urnas apuradas'
          )}
        </span>
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(v) => v && setMode(v as 'hoje' | '2022')}
          className="shrink-0 gap-0.5 rounded-full bg-muted p-0.5"
          aria-label="Comparação"
        >
          <ToggleGroupItem value="hoje" className="h-8 rounded-full px-3 text-[12px] font-semibold text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm">
            Hoje
          </ToggleGroupItem>
          <ToggleGroupItem
            value="2022"
            disabled={past.length < 2}
            className="h-8 rounded-full px-3 text-[12px] font-semibold text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
          >
            × 2022
          </ToggleGroupItem>
        </ToggleGroup>
      </figcaption>
      {show22 && c22 && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          O TSE não publica a série da noite de 2022: os pontos marcados vêm de registros da imprensa e do TSE, o resto é
          interpolado.{flip22 !== null && <> Em 2022, a virada veio com cerca de {fmtPct(flip22, 0)}% das urnas apuradas.</>}
        </p>
      )}
    </figure>
  );
}
