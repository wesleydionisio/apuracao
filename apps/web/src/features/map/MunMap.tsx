// Municípios de uma UF em Canvas (até ~850 polígonos em MG). Toque identifica o município.
import type { CandidateDef } from '@apuracao/shared';
import { geoCentroid, geoContains, geoMercator, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { canvasFill, useThemeColors } from './colors';
import { munPath, useGeo } from './geo';

export interface MunHit {
  ibge: string;
  name: string;
  /** posição do toque relativa ao canvas, em px CSS */
  x: number;
  y: number;
}

export function MunMap({
  uf,
  values,
  cands,
  highlight,
  onPick,
  maxHeight = 420,
  className,
  dim = false,
}: {
  uf: string;
  values: Record<string, number | null | undefined>;
  cands: CandidateDef[];
  highlight?: string | null;
  onPick?: (hit: MunHit | null) => void;
  maxHeight?: number;
  className?: string;
  /** só destacar `highlight`; os demais em cinza */
  dim?: boolean;
}) {
  const { fc, loading } = useGeo(munPath(uf));
  const theme = useThemeColors();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, [fc]);

  // projeção e caixas (para o toque testar só quem está perto)
  const geom = useMemo(() => {
    if (!fc || !width) return null;
    const probe = geoMercator().fitWidth(width, fc as unknown as GeoPermissibleObjects);
    const [[, y0], [, y1]] = geoPath(probe).bounds(fc as unknown as GeoPermissibleObjects);
    const natural = y1 - y0;
    const height = Math.min(maxHeight, Math.ceil(natural));
    const proj = geoMercator().fitSize([width, height], fc as unknown as GeoPermissibleObjects);
    const gp = geoPath(proj);
    const boxes = fc.features.map((f) => gp.bounds(f.geometry));
    return { proj, height, boxes };
  }, [fc, width, maxHeight]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !fc || !geom) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = width * dpr;
    cv.height = geom.height * dpr;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, geom.height);
    const gp = geoPath(geom.proj, ctx);
    const memo = new Map<string, string>();
    let hi: (typeof fc.features)[number] | null = null;
    ctx.lineJoin = 'round';
    for (const f of fc.features) {
      const ibge = String(f.properties.ibge);
      if (ibge === highlight) hi = f;
      const pa = dim && ibge !== highlight ? null : values[ibge];
      const key = pa == null ? 'x' : pa.toFixed(1);
      let col = memo.get(key);
      if (!col) memo.set(key, (col = canvasFill(pa, cands, theme)));
      ctx.beginPath();
      gp(f.geometry);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = theme.card;
      ctx.lineWidth = dim ? 0.3 : 0.5;
      ctx.stroke();
    }
    if (hi) {
      ctx.beginPath();
      gp(hi.geometry);
      ctx.strokeStyle = theme.foreground;
      ctx.lineWidth = 2;
      ctx.stroke();
      if (dim) {
        // anel em volta: município pequeno não some no mapa do estado
        const c = geom.proj(geoCentroid(hi as never));
        if (c) {
          ctx.beginPath();
          ctx.arc(c[0], c[1], 14, 0, Math.PI * 2);
          ctx.strokeStyle = theme.foreground;
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
  }, [fc, geom, values, cands, theme, highlight, dim, width]);

  if (loading && !fc) return <div className={cn('h-64 w-full animate-pulse rounded-xl bg-muted', className)} />;
  if (!fc) return <p className={cn('py-8 text-center text-sm text-muted-foreground', className)}>Mapa municipal indisponível agora.</p>;

  return (
    <div ref={box} className={cn('w-full', className)}>
      <canvas
        ref={canvas}
        data-vaul-no-drag
        className={cn('block w-full', onPick && 'cursor-pointer')}
        style={{ height: geom?.height ?? 240 }}
        role="img"
        aria-label={`Mapa dos municípios de ${uf}`}
        onClick={(e) => {
          if (!onPick || !geom) return;
          const r = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - r.left;
          const y = e.clientY - r.top;
          const pt = geom.proj.invert?.([x, y]);
          if (!pt) return onPick(null);
          for (let i = 0; i < fc.features.length; i++) {
            const [[bx0, by0], [bx1, by1]] = geom.boxes[i];
            if (x < bx0 || x > bx1 || y < by0 || y > by1) continue;
            const f = fc.features[i];
            if (geoContains(f.geometry, pt)) return onPick({ ibge: String(f.properties.ibge), name: String(f.properties.name ?? ''), x, y });
          }
          onPick(null);
        }}
      />
    </div>
  );
}
