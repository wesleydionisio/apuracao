// Malhas IBGE (GeoJSON) carregadas sob demanda, corrigidas para o d3-geo e cacheadas por caminho.
import { geoArea, geoCentroid, geoMercator, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { useEffect, useState } from 'react';
import { getOptional } from '@/lib/api';

export interface GeoFeature {
  type: 'Feature';
  properties: { uf?: string; ibge?: string; name?: string };
  geometry: GeoPermissibleObjects;
}
export interface GeoFC {
  type: 'FeatureCollection';
  features: GeoFeature[];
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
 * Sem isso cada polígono vira "o planeta inteiro menos o estado" e o mapa sai todo pintado.
 */
function rewind(fc: GeoFC): GeoFC {
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
  // municípios sem geometria (ex.: 5101837, criado depois da malha do IBGE) ficam de fora
  fc.features = fc.features.filter((f) => f.geometry);
  return fc;
}

const cache = new Map<string, Promise<GeoFC | null>>();
export function loadGeo(path: string): Promise<GeoFC | null> {
  if (!cache.has(path)) {
    cache.set(
      path,
      getOptional<GeoFC>(path)
        .then((fc) => (fc ? rewind(fc) : null))
        .catch(() => {
          cache.delete(path);
          return null;
        }),
    );
  }
  return cache.get(path)!;
}

export const statesPath = '/geo/uf.json';
export const munPath = (uf: string) => `/geo/mun/${uf.toUpperCase()}.json`;

export function useGeo(path: string | null) {
  const [state, setState] = useState<{ fc: GeoFC | null; loading: boolean }>({ fc: null, loading: !!path });
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setState((s) => (s.fc ? { ...s, loading: true } : { fc: null, loading: true }));
    loadGeo(path).then((fc) => alive && setState({ fc, loading: false }));
    return () => {
      alive = false;
    };
  }, [path]);
  return state;
}

export interface ProjectedState {
  uf: string;
  d: string;
  /** ponto do rótulo (centroide projetado) */
  cx: number;
  cy: number;
  /** área esférica: estados pequenos não ganham rótulo */
  area: number;
}

/** projeta os estados para um viewBox W×H (cache por FC + tamanho) */
const projCache = new WeakMap<GeoFC, Map<string, ProjectedState[]>>();
export function projectStates(fc: GeoFC, W: number, H: number): ProjectedState[] {
  const key = `${W}x${H}`;
  let byKey = projCache.get(fc);
  if (!byKey) projCache.set(fc, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  const proj = geoMercator().fitSize([W, H], fc as unknown as GeoPermissibleObjects);
  const gp = geoPath(proj);
  const out = fc.features.map((f) => {
    const [cx, cy] = proj(geoCentroid(f as never)) ?? [0, 0];
    return {
      uf: String(f.properties.uf ?? '').toUpperCase(),
      d: gp(f.geometry) ?? '',
      cx,
      cy,
      area: geoArea(f as never),
    };
  });
  byKey.set(key, out);
  return out;
}

/** ajustes de rótulo onde o centroide cai mal (litoral recortado, formato em "L") */
export const LABEL_NUDGE: Record<string, [number, number]> = {
  PE: [10, 0],
  BA: [-4, 2],
  MG: [2, 4],
  PA: [0, 6],
  AM: [0, 4],
  GO: [-2, 4],
  RS: [4, -2],
  SC: [6, 0],
  PR: [2, 0],
  ES: [6, 0],
  RJ: [8, 4],
};
