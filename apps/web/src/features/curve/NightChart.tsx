// Gráfico protagonista da noite (estilo Polymarket): % dos válidos de cada candidato × % de urnas apuradas.
// SVG próprio (sem lib de gráficos): rótulos no fim das linhas, ponto ao vivo, scrub por toque, camada de 2022.
import type { Board, CandidateDef } from '@apuracao/shared';
import { twoWay } from '@apuracao/shared';
import NumberFlow from '@number-flow/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CandidateAvatar } from '@/components/core/candidate';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { staticData } from '@/lib/api';
import { fmtPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import { monotonePath, nearest, niceTicks, separate, yDomain, type XY } from './geometry';
import { LAYER, projectionPath } from './layers';
import { Swatch } from './Swatch';
import { useXZoom } from './zoom';
import { ZoomButtons } from './ZoomButtons';
import { matchup2022 } from '@/lib/y2022';

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

/** % de A no confronto A×B do 1º turno 2026 (Brasil) */
export function useT1TwoWay(board: Board): number | null {
  const [v, set] = useState<number | null>(null);
  const nums = board.candidates.map((c) => c.n).join('-');
  useEffect(() => {
    let alive = true;
    staticData
      .hist('t1-2026')
      .then((h) => alive && set(h?.br ? twoWay(h.br, board.candidates) : null))
      .catch(() => alive && set(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nums]);
  return v;
}

export type ChartMode = 'hoje' | '2022' | 't1';
const MODE_LABEL: Record<ChartMode, string> = { hoje: 'Hoje', '2022': '× 2022', t1: '× 1º turno' };

export default function NightChart({
  board,
  className,
  height: forcedHeight,
  modes = ['hoje', '2022', 't1'],
  defaultMode = 'hoje',
  overlays,
  projection: withProjection = true,
  toolbar,
}: {
  board: Board;
  className?: string;
  /** altura fixa (padrão: 236 no celular, 300 a partir de 640px) */
  height?: number;
  /** quais comparações oferecer no seletor (um só = sem seletor) */
  modes?: ChartMode[];
  defaultMode?: ChartMode;
  /** camadas controladas de fora (ex.: chips "Comparar com"); com isso o seletor interno some */
  overlays?: { y22?: boolean; t1?: boolean; proj?: boolean };
  /** desenha a projeção: o caminho do parcial até 100% e a faixa de 95% (padrão: sim, quando houver) */
  projection?: boolean;
  /** botões das camadas, dentro do gráfico (no topo) */
  toolbar?: ReactNode;
}) {
  const [ca, cb] = board.candidates;
  const [mode, setMode] = useState<ChartMode>(defaultMode);
  const c22 = useCurve2022();
  const t1 = useT1TwoWay(board);
  const [wrap, width] = useWidth<HTMLDivElement>();
  const height = forcedHeight ?? (width >= 640 ? 300 : 236);
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
  const show22 = (overlays ? !!overlays.y22 : mode === '2022') && past.length > 1;
  const showT1 = (overlays ? !!overlays.t1 : mode === 't1') && t1 !== null;
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
  // projeção: do ponto de agora até 100%, com a faixa de 95% (layers.ts)
  const showProj = withProjection && (overlays ? overlays.proj !== false : true);
  const cone = useMemo(() => (showProj && last ? projectionPath(board) : null), [showProj, last, board]);
  // "Hoje": o eixo x acompanha a apuração (a linha ocupa a largura); "× 2022": 0–100% para ver a noite inteira
  // a ponta da linha fica em ~45–50% da largura, deixando uma pista à direita para os rótulos
  // com a projeção, o eixo vai até 100%: a linha pontilhada mostra onde a noite deve terminar
  const xMax = show22 || cone || !last ? 100 : Math.min(100, Math.max(10, Math.ceil(pst / 0.5 / 5) * 5));
  const iw = Math.max(0, width - PAD.l - PAD.r);
  const ih = height - PAD.t - PAD.b;
  // zoom e arrasto no eixo x (zoom.ts): [va, vb] é a janela visível
  const zoom = useXZoom(wrap, xMax, { l: PAD.l, w: iw }, (v) => setProbe(v === null ? null : Math.max(0, Math.min(xMax, v))));
  const [va, vb] = zoom.view;
  const vw = Math.max(1e-6, vb - va);
  const inView = (x: number, m = 0) => x >= va - m * vw && x <= vb + m * vw;
  const xTicks = zoom.zoomed ? niceTicks(va, vb) : xMax === 100 ? [0, 25, 50, 75, 100] : [0, xMax / 2, xMax].map((v) => Math.round(v * 10) / 10);
  // o eixo y só considera o que está na janela (com zoom, aproxima de verdade)
  const dom = useMemo(
    () =>
      yDomain(
        [
          ...now.filter((p) => inView(p.x, 0.02)).map((p) => p.a),
          ...(show22 ? past.filter((p) => inView(p.x, 0.02)).map((p) => p.a) : []),
          ...(showT1 ? [t1!] : []),
          ...(cone ? cone.pts.filter((q) => inView(q.x, 0.05)).flatMap((q) => [q.lo, q.hi]) : []),
        ],
        zoom.zoomed,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [now, past, show22, showT1, t1, cone, va, vb, zoom.zoomed],
  );
  const sx = (x: number) => PAD.l + ((x - va) / vw) * iw;
  const sy = (y: number) => PAD.t + ((dom.hi - y) / (dom.hi - dom.lo)) * ih;
  const line = (pts: Pt[], k: 'a' | 'b') => monotonePath(pts.map((p) => [sx(p.x), sy(p[k])] as XY));

  // rótulos do fim da linha (HTML sobre o SVG)
  const labels = useMemo(() => {
    if (!last || !width || !inView(last.x)) return null;
    const ex = sx(last.x);
    // com a projeção à direita da ponta, os rótulos de agora vão para a esquerda
    const right = !cone && ex + 12 + 124 <= PAD.l + iw;
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
  }, [last, width, dom, ih, iw, xMax, cone, va, vb]);

  // rótulos da projeção no fim (100%): o de cima acima da própria linha, o de baixo abaixo
  const projLabels = useMemo(() => {
    if (!cone || !width || vb < 99.5) return null;
    const end = cone.pts[cone.pts.length - 1];
    const aUp = end.mid >= 50;
    const off = 22;
    const [ya, yb] = separate(sy(end.mid) + (aUp ? -off : off), sy(100 - end.mid) + (aUp ? off : -off), 34, PAD.t + 12, PAD.t + ih - 12);
    return { ya, yb, end };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cone, width, dom, ih, va, vb]);

  const pNow = probe !== null ? nearest(now, probe, 6) : null;
  const pPast = probe !== null && show22 ? nearest(past, probe, 8) : null;

  const ariaSummary = last
    ? `${ca.short} ${fmtPct(last.a, 1)}%, ${cb.short} ${fmtPct(last.b, 1)}% com ${fmtPct(pst, 1)}% das urnas apuradas` +
      (cone ? `; projeção de ${ca.short}: ${fmtPct(cone.pa, 1)}% (de ${fmtPct(cone.lo, 1)}% a ${fmtPct(cone.hi, 1)}%)` : '')
    : 'Aguardando as primeiras urnas';

  return (
    <figure className={cn('select-none', className)}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {toolbar ?? <span />}
        {(now.length > 1 || show22 || cone) && <ZoomButtons z={zoom} />}
      </div>
      <div ref={wrap} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} className="absolute inset-0 overflow-visible" role="img" aria-label={`Curva da noite: ${ariaSummary}`}>
            <defs>
              <clipPath id="night-plot">
                <rect x={PAD.l - 6} y={0} width={iw + 12} height={height} />
              </clipPath>
              <pattern id="falta" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--border)" strokeWidth="2" />
              </pattern>
            </defs>
            {/* o que ainda falta apurar */}
            {pst < 99.5 && (
              <g>
                <rect
                  x={Math.max(PAD.l, sx(pst))}
                  y={PAD.t}
                  width={Math.max(0, Math.min(PAD.l + iw, sx(xMax)) - Math.max(PAD.l, sx(pst)))}
                  height={ih}
                  fill="url(#falta)"
                  opacity={0.6}
                />
                {Math.min(PAD.l + iw, sx(xMax)) - Math.max(PAD.l, sx(pst)) > 70 && !labels?.right && (
                  <text
                    x={(Math.max(PAD.l, sx(pst)) + Math.min(PAD.l + iw, sx(xMax))) / 2}
                    y={PAD.t + ih - 8}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[11px]"
                  >
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
                <text x={PAD.l + iw + 8} y={sy(v) + 3.5} className={cn('num text-[11px]', v === 50 ? 'fill-foreground font-medium' : 'fill-muted-foreground')}>
                  {v}%
                </text>
              </g>
            ))}
            {/* grade vertical leve + linha de base */}
            {xTicks.slice(1, -1).map((v) => (
              <line key={`gx-${v}`} x1={sx(v)} x2={sx(v)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--border)" strokeDasharray="1 5" />
            ))}
            <line x1={PAD.l} x2={PAD.l + iw} y1={PAD.t + ih} y2={PAD.t + ih} stroke="var(--border)" />
            {/* referência do 1º turno: confronto A×B como linha horizontal */}
            {showT1 &&
              (['a', 'b'] as const).map((k) => {
                const c = k === 'a' ? ca : cb;
                const v = k === 'a' ? t1! : 100 - t1!;
                const y = sy(v);
                const above = v > 50;
                return (
                  <g key={`t1-${k}`}>
                    <line x1={PAD.l} x2={PAD.l + iw} y1={y} y2={y} stroke={LAYER.t1.color} strokeWidth={LAYER.t1.width} strokeDasharray={LAYER.t1.dash} />
                    {/* com a projeção, à esquerda (a ponta direita é dos rótulos dela); sem, à direita (a esquerda é do começo da noite) */}
                    <text
                      x={cone ? PAD.l + 4 : PAD.l + iw - 4}
                      y={above ? y - 5 : y + 12}
                      textAnchor={cone ? 'start' : 'end'}
                      className="num text-[11px] font-medium"
                      fill={LAYER.t1.color}
                    >
                      1º turno · {c.short.split(' ')[0]} {fmtPct(v, 1)}%
                    </text>
                  </g>
                );
              })}
            {/* eixo x: % de urnas apuradas */}
            {xTicks.map((v, i) => (
              <text
                key={v}
                x={sx(v)}
                y={height - 8}
                textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
                className="num fill-muted-foreground text-[11px]"
              >
                {v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%{i === xTicks.length - 1 && xMax < 100 && !zoom.zoomed ? ' apurado' : ''}
              </text>
            ))}
            {show22 && (
              // 2022 é régua de fundo: tracejado fino e apagado, para não competir com a noite de hoje
              <g opacity={0.75} clipPath="url(#night-plot)">
                <path d={line(past, 'a')} fill="none" stroke={LAYER.y22.color} strokeWidth={LAYER.y22.width} strokeDasharray={LAYER.y22.dash} />
                <path d={line(past, 'b')} fill="none" stroke={LAYER.y22.color} strokeWidth={LAYER.y22.width} strokeDasharray={LAYER.y22.dash} />
                {past
                  .filter((p) => p.src === 'fonte')
                  .map((p) => (
                    <circle key={p.x} cx={sx(p.x)} cy={sy(p.a)} r={2.5} fill="var(--background)" stroke={LAYER.y22.color} strokeWidth={1.25} />
                  ))}
              </g>
            )}
            {now.length > 1 && (
              <g strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={probe !== null ? 0.9 : 1} clipPath="url(#night-plot)">
                <path d={line(now, 'b')} stroke={cb.color} strokeWidth={2.25} />
                <path d={line(now, 'a')} stroke={ca.color} strokeWidth={2.25} />
              </g>
            )}
            {cone && (
              <g clipPath="url(#night-plot)">
                {(['a', 'b'] as const).map((k) => {
                  const c = k === 'a' ? ca : cb;
                  const f = (v: number) => (k === 'a' ? v : 100 - v);
                  const top = cone.pts.map((q) => `${sx(q.x).toFixed(1)},${sy(f(q.hi)).toFixed(1)}`);
                  const bot = [...cone.pts].reverse().map((q) => `${sx(q.x).toFixed(1)},${sy(f(q.lo)).toFixed(1)}`);
                  const end = cone.pts[cone.pts.length - 1];
                  return (
                    <g key={`proj-${k}`}>
                      <path d={`M${top.join('L')}L${bot.join('L')}Z`} fill={c.color} fillOpacity={0.14} />
                      <path
                        d={monotonePath(cone.pts.map((q) => [sx(q.x), sy(f(q.mid))] as XY))}
                        fill="none"
                        stroke={c.color}
                        strokeWidth={LAYER.proj.width}
                        strokeLinecap={LAYER.proj.cap}
                        strokeDasharray={LAYER.proj.dash}
                      />
                      <circle cx={sx(100)} cy={sy(f(end.mid))} r={3.5} fill={c.color} stroke="var(--background)" strokeWidth={1.5} />
                    </g>
                  );
                })}
              </g>
            )}
            {last && inView(last.x) && (
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
            {/* sem linha ainda: os dois no ponto de partida (0% apurado, 50%) */}
            {!last && inView(0) && (
              <g aria-hidden>
                <circle cx={sx(0) + 4} cy={sy(50)} r={4} fill={cb.color} stroke="var(--background)" strokeWidth={1.5} />
                <circle cx={sx(0) + 8} cy={sy(50)} r={4} fill={ca.color} stroke="var(--background)" strokeWidth={1.5} />
                <text x={sx(0) + 18} y={sy(50) - 8} className="fill-foreground text-[11px] font-semibold">
                  {board.released ? 'hoje: aguardando as primeiras urnas' : 'hoje: começa às 17h'}
                </text>
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

        {/* rótulos da projeção no fim da linha pontilhada */}
        {projLabels && (
          <div className={cn('pointer-events-none absolute inset-0 transition-opacity duration-200', probe !== null && 'opacity-25')} aria-hidden>
            {(
              [
                [ca, projLabels.end.mid, projLabels.end.lo, projLabels.end.hi, projLabels.ya],
                [cb, 100 - projLabels.end.mid, 100 - projLabels.end.hi, 100 - projLabels.end.lo, projLabels.yb],
              ] as [CandidateDef, number, number, number, number][]
            ).map(([c, v, lo, hi, y]) => (
              <div key={c.key} className="absolute text-right leading-none" style={{ top: y - 15, right: width - sx(100) + 2 }}>
                <div className="num text-[13px] font-semibold" style={{ color: c.color }}>
                  {fmtPct(v, 1)}%
                </div>
                <div className="num mt-0.5 text-[10px] text-muted-foreground">
                  {fmtPct(lo, 1)}–{fmtPct(hi, 1)}
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
            {show22 && <div className="mt-1 border-t pt-1 text-[10.5px] text-muted-foreground">2022: {matchup2022(board)}</div>}
          </div>
        )}

        {/* camada de captura (zoom.ts): pinça/Ctrl+rolagem aproxima, arrastar move com zoom, sem zoom o dedo lê o valor;
            a vertical rola a página */}
        <div className={cn('absolute inset-0 touch-pan-y', zoom.zoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair')} {...zoom.bind} />

        {now.length < 2 && !show22 && !showT1 && last && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[13px] text-muted-foreground">
            {board.released ? 'A curva aparece com as primeiras urnas apuradas' : 'Às 17h a curva de hoje começa aqui'}
          </div>
        )}
      </div>

      <figcaption className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {/* legenda: uma amostra do traço por camada ligada (as mesmas dos chips) */}
        <span className="flex min-h-4 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-tight text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Swatch k="hoje" cands={board.candidates} />% dos válidos
          </span>
          {cone && (
            <span className="inline-flex items-center gap-1.5">
              <Swatch k="proj" cands={board.candidates} />
              projeção até 100% · faixa de 95%
            </span>
          )}
          {show22 && (
            <span className="inline-flex items-center gap-1.5">
              <Swatch k="y22" cands={board.candidates} />
              {`2022, ${matchup2022(board)} (reconstrução)`}
              {flip22 !== null ? ` · virou com ${fmtPct(flip22, 0)}%` : ''}
            </span>
          )}
          {showT1 && (
            <span className="inline-flex items-center gap-1.5">
              <Swatch k="t1" cands={board.candidates} />1º turno
            </span>
          )}
        </span>
        {!overlays && modes.length > 1 && (
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => v && setMode(v as ChartMode)}
            className="shrink-0 gap-0.5 rounded-full bg-muted p-0.5"
            aria-label="Comparar a curva de hoje com"
          >
            {modes.map((m) => (
              <ToggleGroupItem
                key={m}
                value={m}
                disabled={(m === '2022' && past.length < 2) || (m === 't1' && t1 === null)}
                className="h-8 rounded-full px-3 text-[12px] font-semibold whitespace-nowrap text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
              >
                {MODE_LABEL[m]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </figcaption>
    </figure>
  );
}
