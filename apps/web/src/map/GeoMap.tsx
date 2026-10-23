// Mapa geográfico (d3-geo). Estados em SVG; municípios em Canvas (milhares de polígonos).
import type { CandidateDef } from '@apuracao/shared';
import { geoContains, geoMercator, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getOptional } from '../lib/api';
import { marginColor } from './color';

interface Feature {
  type: 'Feature';
  properties: { uf?: string; ibge?: string; name?: string };
  geometry: GeoPermissibleObjects;
}
interface FC {
  type: 'FeatureCollection';
  features: Feature[];
}

type Ring = [number, number][];

/** área planar com sinal (lon/lat): < 0 = anti-horário */
function ringArea(r: Ring) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return -a / 2;
}

/**
 * GeoJSON RFC 7946 usa anel externo anti-horário; o d3-geo (esférico) espera horário.
 * Sem isso cada polígono vira "o planeta inteiro menos a cidade" e o mapa sai todo pintado.
 */
function rewind(fc: FC): FC {
  const fixPoly = (rings: Ring[]) =>
    rings.map((r, i) => {
      const ccw = ringArea(r) < 0;
      return (i === 0 ? ccw : !ccw) ? [...r].reverse() : r;
    });
  for (const f of fc.features) {
    const g = f.geometry as unknown as { type: string; coordinates: unknown } | null;
    if (!g) continue;
    if (g.type === 'Polygon') g.coordinates = fixPoly(g.coordinates as Ring[]);
    else if (g.type === 'MultiPolygon') g.coordinates = (g.coordinates as Ring[][]).map(fixPoly);
  }
  // municípios sem geometria (ex.: criados depois da malha do IBGE) ficam de fora
  fc.features = fc.features.filter((f) => f.geometry);
  return fc;
}

const geoCache = new Map<string, Promise<FC | null>>();
function loadGeo(path: string) {
  if (!geoCache.has(path))
    geoCache.set(
      path,
      getOptional<FC>(path)
        .then((fc) => (fc ? rewind(fc) : null))
        .catch(() => null),
    );
  return geoCache.get(path)!;
}

function useGeo(path: string) {
  const [state, setState] = useState<{ fc: FC | null; loading: boolean }>({ fc: null, loading: true });
  useEffect(() => {
    let alive = true;
    setState({ fc: null, loading: true });
    loadGeo(path).then((fc) => alive && setState({ fc, loading: false }));
    return () => {
      alive = false;
    };
  }, [path]);
  return state;
}

export function StatesSvg({
  values,
  cands,
  onPick,
  selected,
}: {
  values: Record<string, number | null | undefined>;
  cands: CandidateDef[];
  onPick?: (uf: string) => void;
  selected?: string | null;
}) {
  const { fc, loading } = useGeo('/geo/uf.json');
  const W = 400;
  const H = 400;
  const paths = useMemo(() => {
    if (!fc) return [];
    const proj = geoMercator().fitSize([W, H], fc as unknown as GeoPermissibleObjects);
    const gp = geoPath(proj);
    return fc.features.map((f) => ({ uf: String(f.properties.uf ?? '').toUpperCase(), d: gp(f.geometry) ?? '' }));
  }, [fc]);
  if (loading) return <div className="aspect-square w-full animate-pulse rounded-2xl bg-soft" />;
  if (!fc) return <p className="py-8 text-center text-[13px] text-muted">Malha geográfica ainda não publicada. Use a grade.</p>;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full max-w-[460px]" role="img" aria-label="Mapa do Brasil por estado">
      {paths.map((p) => (
        <path
          key={p.uf}
          d={p.d}
          fill={marginColor(values[p.uf], cands)}
          stroke={selected === p.uf ? 'var(--fg)' : 'var(--bg)'}
          strokeWidth={selected === p.uf ? 2 : 0.8}
          onClick={() => onPick?.(p.uf)}
          className="cursor-pointer"
        />
      ))}
    </svg>
  );
}

/** Municípios de uma UF em Canvas. Toque identifica o município. */
export function MunCanvas({
  uf,
  values,
  cands,
  onPick,
}: {
  uf: string;
  values: Record<string, number | null | undefined>;
  cands: CandidateDef[];
  onPick?: (ibge: string, name: string) => void;
}) {
  const { fc, loading } = useGeo(`/geo/mun/${uf}.json`);
  const ref = useRef<HTMLCanvasElement>(null);
  const projRef = useRef<ReturnType<typeof geoMercator> | null>(null);
  const SIZE = 360;

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !fc) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = SIZE * dpr;
    cv.height = SIZE * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const proj = geoMercator().fitSize([SIZE, SIZE], fc as unknown as GeoPermissibleObjects);
    projRef.current = proj;
    const gp = geoPath(proj, ctx);
    // canvas não entende var()/color-mix: resolve via um elemento de teste
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const resolve = (c: string) => {
      probe.style.color = c;
      return getComputedStyle(probe).color;
    };
    const stroke = resolve('var(--bg)');
    const cache = new Map<string, string>();
    ctx.clearRect(0, 0, SIZE, SIZE);
    for (const f of fc.features) {
      const col = marginColor(values[String(f.properties.ibge)], cands);
      if (!cache.has(col)) cache.set(col, resolve(col));
      ctx.beginPath();
      gp(f.geometry);
      ctx.fillStyle = cache.get(col)!;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 0.4;
      ctx.stroke();
    }
    probe.remove();
  }, [fc, values, cands]);

  if (loading) return <div className="aspect-square w-full animate-pulse rounded-2xl bg-soft" />;
  if (!fc) return <p className="py-6 text-center text-[13px] text-muted">Mapa municipal desta UF ainda não disponível.</p>;
  return (
    <canvas
      ref={ref}
      className="mx-auto block aspect-square w-full max-w-[460px]"
      onClick={(e) => {
        if (!onPick || !projRef.current) return;
        const r = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * SIZE;
        const y = ((e.clientY - r.top) / r.height) * SIZE;
        const pt = projRef.current.invert?.([x, y]);
        if (!pt) return;
        const hit = fc.features.find((f) => geoContains(f.geometry, pt));
        if (hit) onPick(String(hit.properties.ibge), String(hit.properties.name ?? ''));
      }}
    />
  );
}
