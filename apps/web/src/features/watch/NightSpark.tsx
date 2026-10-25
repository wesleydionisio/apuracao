// Mini gráfico da noite para a tela Ao vivo: % dos válidos × % de urnas apuradas.
// O eixo x dá zoom conforme a apuração: no começo mostra só o trecho inicial (a curva não fica espremida num canto)
// e vai abrindo até 0–100% perto do fim. Com a curva de 2022 ligada (ou antes das 17h, `fullAxis`) é sempre a noite
// inteira, para ver onde a liderança virou em 2022. Com zoom, a virada de 2022 fora da janela vira um aviso na borda.
import type { Board } from '@apuracao/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LAYER, projectionPath } from '@/features/curve/layers';
import { ZoomButtons } from '@/features/curve/ZoomButtons';
import { useXZoom } from '@/features/curve/zoom';
import { matchup2022 } from '@/lib/y2022';
import { cn } from '@/lib/utils';

type P = [number, number];

/** até onde o eixo x vai: ~1,3× o apurado com folga, em degraus de 5 pontos; de 75% em diante, a noite inteira */
export function xWindow(pst: number): number {
  if (pst >= 75) return 100;
  return Math.min(100, Math.max(15, Math.ceil((pst * 1.3 + 6) / 5) * 5));
}

/** acompanha o alvo com uma transição curta (o zoom "abre" em vez de pular) */
function useTween(target: number, ms = 600): number {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    const from = cur.current;
    if (from === target) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      cur.current = from + (target - from) * (1 - (1 - t) ** 3);
      setV(cur.current);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** cúbica monotônica (não "passa do ponto" entre amostras) */
function path(pts: P[]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  const n = pts.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0;
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  t[n - 1] = m[n - 2];
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + t[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function NightSpark({
  board,
  curve22,
  t1,
  flip22,
  height = 112,
  fullAxis = false,
  proj = false,
  className,
}: {
  board: Board;
  curve22?: { pst: number; pa: number }[] | null;
  /** % de A no confronto A×B do 1º turno: vira uma linha horizontal por candidato */
  t1?: number | null;
  /** onde a liderança trocou em 2022 (% apurado) e quem passou à frente: marcador vertical */
  flip22?: { pst: number; lead: 'a' | 'b' } | null;
  height?: number;
  /** eixo x sempre 0–100% (antes das 17h: a noite inteira, com a referência de 2022) */
  fullAxis?: boolean;
  /** projeção: do ponto de agora até 100%, com a faixa de 95% */
  proj?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const [ca, cb] = board.candidates;
  // ignora o ruído das primeiras urnas (< 0,5%)
  const pts = useMemo(() => board.curve.filter((p) => p.pst >= 0.5), [board.curve]);
  const last = pts[pts.length - 1];
  const cone = useMemo(() => (proj && last ? projectionPath(board, 24) : null), [proj, last, board]);

  const padL = 4;
  const padR = 44;
  const padT = 10;
  const padB = 16;
  const iw = Math.max(80, w - padL - padR);
  const ih = height - padT - padB;

  // com 2022 na tela, a comparação precisa da noite inteira (a virada pode estar lá na frente)
  // com 2022 ou com a projeção na tela, a noite inteira (a projeção vai até 100%)
  const xMax = useTween(fullAxis || curve22?.length || cone ? 100 : xWindow(last?.pst ?? 0));
  // zoom e arrasto no eixo x (curve/zoom.ts): [va, vb] é a janela visível
  const [probe, setProbe] = useState<number | null>(null);
  const zoom = useXZoom(ref, xMax, { l: padL, w: iw }, (v) => setProbe(v === null ? null : Math.max(0, Math.min(100, v))));
  const [va, vb] = zoom.view;
  const vw = Math.max(1e-6, vb - va);
  const full = vb > 99.5;
  const inView = (pst: number, m = 0) => pst >= va - m * vw && pst <= vb + m * vw;
  // o eixo y só considera o que está na janela (com zoom, aproxima de verdade)
  const vis22 = (curve22 ?? []).filter((p) => inView(p.pst, 0.02));
  const dev = Math.max(
    zoom.zoomed ? 1.5 : 4,
    ...pts.filter((p) => inView(p.pst, 0.02)).map((p) => Math.abs(p.pa - 50)),
    ...vis22.map((p) => Math.abs(p.pa - 50)),
    t1 != null ? Math.abs(t1 - 50) : 0,
    ...(cone ? cone.pts.filter((q) => inView(q.x, 0.05)).flatMap((q) => [Math.abs(q.lo - 50), Math.abs(q.hi - 50)]) : []),
  );
  const span = zoom.zoomed ? Math.ceil(dev + 0.5) : Math.ceil((dev + 1) / 5) * 5;
  const x = (pst: number) => padL + ((pst - va) / vw) * iw;
  const xEnd = padL + iw;
  /** posição relativa na largura (0–1), para decidir onde cabe rótulo */
  const frac = (pst: number) => Math.min(1, Math.max(0, (pst - va) / vw));
  const y = (pa: number) => padT + ((50 + span - pa) / (2 * span)) * ih;

  const lineA = path(pts.map((p) => [x(p.pst), y(p.pa)]));
  const lineB = path(pts.map((p) => [x(p.pst), y(100 - p.pa)]));
  // até o primeiro ponto depois da janela (o recorte do svg corta o excesso)
  const g22 = curve22?.length ? curve22 : null;
  const a22 = g22 ? path(g22.map((p) => [x(p.pst), y(p.pa)])) : '';
  const b22 = g22 ? path(g22.map((p) => [x(p.pst), y(100 - p.pa)])) : '';

  // leitura por ponto: mouse por cima ou dedo (tocar/arrastar sem zoom) mostra hoje e 2022 naquele % apurado
  const nowAt =
    probe !== null && last && probe <= last.pst + 1
      ? pts.reduce((b, p) => (Math.abs(p.pst - probe) < Math.abs(b.pst - probe) ? p : b), pts[0])
      : null;
  const at22 = (pst: number) => {
    if (!g22) return null;
    const i = g22.findIndex((p) => p.pst >= pst);
    if (i <= 0) return i === 0 ? g22[0].pa : g22[g22.length - 1].pa;
    const [p0, p1] = [g22[i - 1], g22[i]];
    return p0.pa + ((p1.pa - p0.pa) * (pst - p0.pst)) / (p1.pst - p0.pst || 1);
  };
  const xAt = nowAt ? nowAt.pst : probe;
  const pa22 = xAt !== null ? at22(xAt) : null;

  // rótulos nas pontas, sem sobrepor
  let ya = last ? y(last.pa) : 0;
  let yb = last ? y(100 - last.pa) : 0;
  if (last && Math.abs(ya - yb) < 14) {
    const mid = (ya + yb) / 2;
    const up = ya < yb ? -7 : 7;
    ya = mid + up;
    yb = mid - up;
  }

  return (
    <div
      ref={ref}
      className={cn('relative w-full touch-pan-y select-none', zoom.zoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair', className)}
      style={{ height }}
      {...zoom.bind}
    >
      <svg width={w} height={height} className="block overflow-visible" role="img" aria-label={last ? `Evolução da noite: com ${fmt(last.pst)}% apurado, ${ca.short} ${fmt(last.pa)}% e ${cb.short} ${fmt(100 - last.pa)}%` : 'Evolução da noite'}>
        <defs>
          <pattern id="spark-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="stroke-border" strokeWidth="1" />
          </pattern>
          <clipPath id="spark-plot">
            <rect x={padL} y={0} width={iw} height={height} />
          </clipPath>
        </defs>
        {/* o que falta apurar */}
        {last && last.pst < 99.5 && (
          <rect x={x(last.pst)} y={padT} width={Math.max(0, xEnd - x(last.pst))} height={ih} fill="url(#spark-hatch)" opacity={0.55} />
        )}
        <line x1={padL} x2={xEnd} y1={y(50)} y2={y(50)} className="stroke-muted-foreground/40" strokeDasharray="3 4" />
        <text x={xEnd + 6} y={y(50) + 3.5} className="fill-muted-foreground text-[11px] font-medium tabular-nums">
          50%
        </text>
        <text x={xEnd + 6} y={padT + 4} className="fill-muted-foreground/70 text-[11px] tabular-nums">
          {50 + span}
        </text>
        <text x={xEnd + 6} y={padT + ih} className="fill-muted-foreground/70 text-[11px] tabular-nums">
          {50 - span}
        </text>
        {/* virada de 2022: linha vertical no % apurado em que a liderança trocou — a zona de atenção da noite */}
        {/* virada de 2022 ainda fora da janela do zoom: o ponto crítico não some, vira um aviso na borda */}
        {flip22 && flip22.pst > vb + 0.5 && (
          // com zoom, abaixo dos botões (o "ver tudo" ocupa o topo)
          <text x={xEnd - 2} y={padT + (zoom.zoomed ? 30 : 8)} textAnchor="end" className="fill-foreground/80 text-[11px] font-medium tabular-nums">
            virada em 2022 · {fmt(flip22.pst)}% →
          </text>
        )}
        {flip22 && inView(flip22.pst) && (
          <g aria-hidden>
            <line x1={x(flip22.pst)} x2={x(flip22.pst)} y1={padT} y2={padT + ih} className="stroke-foreground/50" strokeWidth={1.25} strokeDasharray="2 3" />
            <circle cx={x(flip22.pst)} cy={y(50)} r={3.5} fill={(flip22.lead === 'a' ? ca : cb).color} className="stroke-background" strokeWidth={1.5} />
            <text
              x={frac(flip22.pst) < 0.45 ? x(flip22.pst) + 4 : x(flip22.pst) - 4}
              y={padT + 8}
              textAnchor={frac(flip22.pst) < 0.45 ? 'start' : 'end'}
              className="fill-foreground/80 text-[11px] font-medium tabular-nums"
            >
              virada em 2022 · {fmt(flip22.pst)}%
            </text>
          </g>
        )}
        {/* 1º turno: confronto A×B como linha horizontal, rótulo à direita (o começo da curva é a parte agitada) */}
        {t1 != null &&
          [
            { c: ca, v: t1 },
            { c: cb, v: 100 - t1 },
          ].map(({ c, v }) => (
            <g key={`t1-${c.key}`}>
              <line x1={padL} x2={xEnd} y1={y(v)} y2={y(v)} stroke={LAYER.t1.color} strokeWidth={LAYER.t1.width} strokeDasharray={LAYER.t1.dash} />
              <text x={padL + 2} y={v > 50 ? y(v) - 4 : y(v) + 11} className="text-[11px] font-medium tabular-nums" fill={LAYER.t1.color}>
                1º turno · {c.short.split(' ')[0]} {fmt(v)}%
              </text>
            </g>
          ))}
        {g22 && (
          <g opacity={0.75} clipPath="url(#spark-plot)">
            <path d={a22} fill="none" stroke={LAYER.y22.color} strokeWidth={LAYER.y22.width} strokeDasharray={LAYER.y22.dash} />
            <path d={b22} fill="none" stroke={LAYER.y22.color} strokeWidth={LAYER.y22.width} strokeDasharray={LAYER.y22.dash} />
          </g>
        )}
        {cone && (
          <g clipPath="url(#spark-plot)">
            {[
              { c: ca, f: (v: number) => v },
              { c: cb, f: (v: number) => 100 - v },
            ].map(({ c, f }) => {
              const top = cone.pts.map((q) => `${x(q.x).toFixed(1)},${y(f(q.hi)).toFixed(1)}`);
              const bot = [...cone.pts].reverse().map((q) => `${x(q.x).toFixed(1)},${y(f(q.lo)).toFixed(1)}`);
              return (
                <g key={`proj-${c.key}`}>
                  <path d={`M${top.join('L')}L${bot.join('L')}Z`} fill={c.color} fillOpacity={0.14} />
                  <path
                    d={path(cone.pts.map((q) => [x(q.x), y(f(q.mid))]))}
                    fill="none"
                    stroke={c.color}
                    strokeWidth={LAYER.proj.width}
                    strokeLinecap={LAYER.proj.cap}
                    strokeDasharray={LAYER.proj.dash}
                  />
                </g>
              );
            })}
          </g>
        )}
        {cone && full && (
          // projeção final na ponta (100%): o de cima acima da linha, o de baixo abaixo
          <g aria-hidden>
            {[
              { c: ca, v: cone.pa },
              { c: cb, v: 100 - cone.pa },
            ].map(({ c, v }) => (
              <g key={`pe-${c.key}`}>
                <circle cx={xEnd} cy={y(v)} r={3} fill={c.color} className="stroke-background" strokeWidth={1.5} />
                <text x={xEnd - 5} y={v >= 50 ? y(v) - 6 : y(v) + 13} textAnchor="end" className="text-[11px] font-semibold tabular-nums" fill={c.color}>
                  {fmt(v)}%
                </text>
              </g>
            ))}
          </g>
        )}
        <g clipPath="url(#spark-plot)">
          <path d={lineB} fill="none" stroke={cb.color} strokeWidth={2.25} strokeLinecap="round" />
          <path d={lineA} fill="none" stroke={ca.color} strokeWidth={2.25} strokeLinecap="round" />
        </g>
        {/* antes das 17h: o 2º turno de hoje zerado, os dois no ponto de partida */}
        {!pts.length && fullAxis && (
          <g aria-hidden>
            <circle cx={x(0)} cy={y(50)} r={4} fill={cb.color} className="stroke-background" strokeWidth={1.5} opacity={inView(0) ? 1 : 0} />
            <circle cx={x(0) + 3} cy={y(50)} r={4} fill={ca.color} className="stroke-background" strokeWidth={1.5} />
            <text x={x(0) + 12} y={y(50) - 7} className="fill-foreground text-[11px] font-semibold tabular-nums">
              hoje: 0% apurado
            </text>
          </g>
        )}
        {last && inView(last.pst) && (
          <>
            {[
              { c: ca, py: y(last.pa), ly: ya, v: last.pa },
              { c: cb, py: y(100 - last.pa), ly: yb, v: 100 - last.pa },
            ].map(({ c, py, ly, v }) => (
              <g key={c.key}>
                <circle cx={x(last.pst)} cy={py} r={7} fill={c.color} opacity={0.18} className="live-ping" style={{ transformOrigin: `${x(last.pst)}px ${py}px` }} />
                <circle cx={x(last.pst)} cy={py} r={3.5} fill={c.color} className="stroke-background" strokeWidth={1.5} />
                {cone ? (
                  frac(last.pst) > 0.12 && (
                    <text x={x(last.pst) - 8} y={ly + 3.5} textAnchor="end" className="text-[11px] font-semibold tabular-nums" fill={c.color}>
                      {fmt(v)}%
                    </text>
                  )
                ) : (
                  frac(last.pst) < 0.86 && (
                    <text x={x(last.pst) + 8} y={ly + 3.5} className="text-[11px] font-semibold tabular-nums" fill={c.color}>
                      {fmt(v)}%
                    </text>
                  )
                )}
              </g>
            ))}
          </>
        )}
        {xAt !== null && (
          <g aria-hidden>
            <line x1={x(xAt)} x2={x(xAt)} y1={padT} y2={padT + ih} className="stroke-foreground/40" />
            {nowAt &&
              [
                { c: ca, v: nowAt.pa },
                { c: cb, v: 100 - nowAt.pa },
              ].map(({ c, v }) => <circle key={c.key} cx={x(nowAt.pst)} cy={y(v)} r={3.5} fill={c.color} className="stroke-background" strokeWidth={1.5} />)}
          </g>
        )}
        <text x={padL} y={height - 2} className="fill-muted-foreground text-[11px] tabular-nums">
          {va < 0.05 ? '0' : fmt(va)}%
        </text>
        <text x={xEnd} y={height - 2} textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
          {full ? '100% apurado' : zoom.zoomed ? `${fmt(vb)}%` : `${Math.round(vb)}%`}
        </text>
        {last && inView(last.pst) && frac(last.pst) > 0.12 && frac(last.pst) < 0.85 && (
          <text x={x(last.pst)} y={height - 2} textAnchor="middle" className="fill-foreground text-[11px] font-medium tabular-nums">
            {fmt(last.pst)}%
          </text>
        )}
      </svg>
      {xAt !== null && (nowAt || pa22 !== null) && (
        <div
          className="pointer-events-none absolute top-0 z-10 min-w-36 -translate-x-1/2 rounded-lg border bg-popover/95 px-2.5 py-1.5 text-[12px] shadow-lg backdrop-blur"
          style={{ left: `clamp(76px, ${x(xAt)}px, calc(100% - 76px))` }}
          role="tooltip"
        >
          <div className="num mb-0.5 flex justify-between gap-3 text-[11px] text-muted-foreground">
            <span>{fmt(xAt)}% apurado</span>
            {pa22 !== null && (
              <span className="flex gap-3">
                <span className="w-10 text-right">hoje</span>
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
                <span className="w-10 text-right font-semibold">{nowAt ? `${fmt(c.key === 'a' ? nowAt.pa : 100 - nowAt.pa)}%` : '—'}</span>
                {pa22 !== null && <span className="w-9 text-right text-muted-foreground">{fmt(c.key === 'a' ? pa22 : 100 - pa22)}</span>}
              </span>
            </div>
          ))}
          {pa22 !== null && <div className="mt-1 border-t pt-1 text-[10.5px] text-muted-foreground">2022: {matchup2022(board)}</div>}
        </div>
      )}
      {/* botões só com a linha de hoje: antes das 17h eles cobririam os rótulos (a pinça segue valendo) */}
      {pts.length > 1 && <ZoomButtons z={zoom} className="absolute top-0 left-1" />}
      {/* sem linha ainda e sem referências desenhadas: o aviso no meio (com 2022/1º turno ele cobriria os rótulos) */}
      {!pts.length && !g22 && t1 == null && !fullAxis && (
        <div className="absolute inset-0 flex items-center justify-center text-[12px] text-muted-foreground">
          A linha começa a se formar com as primeiras urnas.
        </div>
      )}
    </div>
  );
}
