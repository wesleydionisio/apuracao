// Mapa-múndi do painel do exterior: um círculo por cidade onde brasileiros votam, do tamanho do eleitorado e na cor
// de quem lidera ali (três tons pela vantagem, como os hexágonos); cinza enquanto não há votos. Os círculos têm
// tamanho fixo na tela: com zoom eles se afastam e os nomes aparecem. Mesmo zoom/arrasto do HexMap (viewport.ts).
import type { CandidateDef } from '@apuracao/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { ABROAD } from './abroad-coords';
import { useThemeColors } from './colors';
import { bandOfMargin, rgbCss, shades, toRgb } from './hex';
import { useViewport } from './viewport';
import { ZoomControls } from './ZoomControls';

export interface WorldCity {
  ibge: string;
  tse: string;
  name: string;
  el: number;
  /** % de A na camada do mapa; null = sem votos */
  pa: number | null;
}

export interface WorldHit {
  ibge: string;
  x: number;
  y: number;
}

interface World {
  land: number[][];
  br: number[][];
}

let worldPromise: Promise<World> | null = null;
const loadWorld = () =>
  (worldPromise ??= fetch('/geo/world.json').then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<World>;
  }));

/** Natural Earth I (a mesma fórmula do d3-geo), em radianos → unidades do mapa (y para baixo) */
function project(lon: number, lat: number): [number, number] {
  const l = (lon * Math.PI) / 180;
  const p = (lat * Math.PI) / 180;
  const p2 = p * p;
  const p4 = p2 * p2;
  return [
    l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))),
    -p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))),
  ];
}

/** recorte: do Alasca à Nova Zelândia, sem os polos */
const [X0] = project(-180, 0);
const [X1] = project(180, 0);
const Y0 = project(0, 72)[1];
const Y1 = project(0, -50)[1];

function ringsPath(rings: number[][]): Path2D {
  const p = new Path2D();
  for (const r of rings) {
    for (let i = 0; i < r.length; i += 2) {
      const [x, y] = project(r[i], r[i + 1]);
      if (i) p.lineTo(x, y);
      else p.moveTo(x, y);
    }
    p.closePath();
  }
  return p;
}

/** raio na tela (px CSS) pelo eleitorado: área proporcional, entre 2,5 e 13 px */
const radius = (el: number, max: number) => Math.max(2.5, Math.sqrt(el / max) * 13);

export default function WorldMap({
  cities,
  cands,
  highlight,
  onPick,
  maxHeight,
  className,
}: {
  cities: WorldCity[];
  cands: CandidateDef[];
  highlight?: string | null;
  onPick?: (hit: WorldHit | null) => void;
  maxHeight?: number;
  className?: string;
}) {
  const theme = useThemeColors();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cssW, setCssW] = useState(0);
  const [world, setWorld] = useState<{ land: Path2D; br: Path2D } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    loadWorld()
      .then((w) => setWorld({ land: ringsPath(w.land), br: ringsPath(w.br) }))
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCssW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const frame = useMemo(() => {
    if (!cssW) return null;
    let s0 = cssW / (X1 - X0);
    let h = (Y1 - Y0) * s0;
    if (maxHeight && h > maxHeight) {
      s0 = maxHeight / (Y1 - Y0);
      h = maxHeight;
    }
    return { s0, offX: (cssW - (X1 - X0) * s0) / 2, h: Math.round(h) };
  }, [cssW, maxHeight]);
  const cssH = frame?.h ?? 0;

  // cidades com coordenada, maiores primeiro (as pequenas desenhadas por cima)
  const pts = useMemo(() => {
    const max = Math.max(1, ...cities.map((c) => c.el));
    return cities
      .flatMap((c) => {
        const g = ABROAD[c.tse];
        if (!g) return [];
        const [x, y] = project(g[0], g[1]);
        return [{ ...c, x, y, r: radius(c.el, max) }];
      })
      .sort((a, b) => b.el - a.el);
  }, [cities]);

  const pal = useMemo(() => ({ a: shades(toRgb(cands[0].color)).map(rgbCss), b: shades(toRgb(cands[1].color)).map(rgbCss) }), [cands]);

  const draw = useRef<() => void>(() => {});
  const rafId = useRef(0);
  const kick = useCallback(() => {
    if (rafId.current) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = 0;
      draw.current();
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(rafId.current), []);

  /** transformação atual: tela = mapa × T + (tx, ty) */
  const xform = () => {
    const { k, x, y } = vp.v.current;
    const T = frame!.s0 * k;
    return { T, tx: (frame!.offX - X0 * frame!.s0) * k + x, ty: -Y0 * frame!.s0 * k + y, k };
  };

  const hitAt = (sx: number, sy: number): WorldHit | null => {
    if (!frame) return null;
    const { T, tx, ty } = xform();
    let best: (typeof pts)[number] | null = null;
    let bestD = Infinity;
    for (const p of pts) {
      const d = Math.hypot(p.x * T + tx - sx, p.y * T + ty - sy);
      // alvo de no mínimo 14 px; entre vizinhos, vale o centro mais perto
      if (d <= Math.max(p.r + 6, 14) && d < bestD) [best, bestD] = [p, d];
    }
    return best ? { ibge: best.ibge, x: best.x * T + tx, y: best.y * T + ty } : null;
  };

  const vp = useViewport(canvas, cssW, cssH, kick, (x, y) => onPick?.(hitAt(x, y)));

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !frame || !world) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(cssW * dpr);
    const H = Math.round(cssH * dpr);
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    const ctx = cv.getContext('2d')!;
    draw.current = () => {
      const { T, tx, ty, k } = xform();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.setTransform(dpr * T, 0, 0, dpr * T, dpr * tx, dpr * ty);
      ctx.fillStyle = theme.foreground;
      ctx.globalAlpha = 0.09;
      ctx.fill(world.land);
      // o Brasil só contornado: o que está no mapa é o voto de fora dele
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1 / T;
      ctx.setLineDash([3 / T, 2.5 / T]);
      ctx.strokeStyle = theme.foreground;
      ctx.stroke(world.br);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // círculos em px de tela
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      let hi: (typeof pts)[number] | null = null;
      for (const p of pts) {
        const sx = p.x * T + tx;
        const sy = p.y * T + ty;
        if (sx < -20 || sx > cssW + 20 || sy < -20 || sy > cssH + 20) continue;
        if (p.ibge === highlight) hi = p;
        ctx.beginPath();
        ctx.arc(sx, sy, p.r, 0, Math.PI * 2);
        if (p.pa == null) {
          ctx.fillStyle = theme.foreground;
          ctx.globalAlpha = 0.28;
        } else {
          const i = bandOfMargin(Math.abs(2 * p.pa - 100));
          ctx.fillStyle = p.pa >= 50 ? pal.a[i] : pal.b[i];
          ctx.globalAlpha = 0.92;
        }
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        ctx.strokeStyle = theme.card;
        ctx.stroke();
      }
      if (hi) {
        ctx.beginPath();
        ctx.arc(hi.x * T + tx, hi.y * T + ty, hi.r + 2.5, 0, Math.PI * 2);
        ctx.lineWidth = 1.75;
        ctx.strokeStyle = theme.foreground;
        ctx.stroke();
      }
      // nomes com zoom: primeiro os maiores eleitorados, sem sobrepor
      if (k >= 2.5) {
        ctx.font = '500 11px Inter, system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        const taken: [number, number, number, number][] = [];
        for (const p of pts) {
          if (p.r < (k >= 6 ? 0 : k >= 4 ? 4 : 6.5)) continue;
          const sx = p.x * T + tx + p.r + 3;
          const sy = p.y * T + ty;
          if (sx < 0 || sx > cssW || sy < 0 || sy > cssH) continue;
          const w = ctx.measureText(p.name).width;
          const box: [number, number, number, number] = [sx, sy - 7, sx + w, sy + 7];
          if (taken.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
          taken.push(box);
          ctx.fillStyle = theme.card;
          ctx.globalAlpha = 0.75;
          ctx.fillRect(box[0] - 2, box[1], w + 4, 14);
          ctx.globalAlpha = 1;
          ctx.fillStyle = theme.foreground;
          ctx.fillText(p.name, sx, sy);
        }
      }
    };
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, frame, pts, cssW, cssH, theme, pal, highlight, kick]);

  if (failed) return <p className={cn('py-10 text-center text-sm text-muted-foreground', className)}>Não foi possível carregar o mapa.</p>;

  return (
    <div ref={wrap} className={cn('relative w-full overflow-hidden rounded-xl', className)}>
      {(!frame || !world) && <div className="w-full animate-pulse rounded-xl bg-muted/60" style={{ height: cssH || 200 }} />}
      <canvas
        ref={canvas}
        data-vaul-no-drag
        tabIndex={0}
        {...vp.bind}
        className={cn('block w-full cursor-grab select-none focus-visible:outline-offset-[-2px] active:cursor-grabbing', (!frame || !world) && 'hidden')}
        style={{ height: cssH || undefined, touchAction: vp.zoomed ? 'none' : 'pan-y' }}
        role="img"
        aria-label="Mapa-múndi com as cidades onde brasileiros votam no exterior, na cor de quem lidera em cada uma"
      />
      {frame && world && <ZoomControls row zoomed={vp.zoomed} away={vp.away} onIn={() => vp.zoomBy(2)} onOut={() => vp.zoomBy(0.5)} onReset={vp.reset} />}
    </div>
  );
}
