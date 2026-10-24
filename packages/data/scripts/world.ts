// Mapa-múndi leve para o painel do exterior → apps/web/public/geo/world.json
// Natural Earth 1:110m (terra + contorno do Brasil), sem a Antártida, coordenadas com 1 casa e simplificadas.
// Formato: { land: number[][], br: number[][] }, cada anel achatado em [lon, lat, lon, lat, ...].
import { join } from 'node:path';
import { cachedJson, GEO, isMain, kb, sizes, writeJson } from './lib';

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson';
/** tolerância da simplificação, em graus */
const TOL = 0.25;

type Pt = [number, number];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FC = { features: { geometry: { type: string; coordinates: any }; properties: Record<string, unknown> }[] };

function perpDist(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (!dx && !dy) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / Math.hypot(dx, dy);
}

function dp(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let max = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(pts[i], pts[s], pts[e]);
      if (d > max) [max, idx] = [d, i];
    }
    if (idx > 0 && max > tol) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/** anéis externos de um Polygon/MultiPolygon (buracos não aparecem nessa escala) */
function outerRings(g: FC['features'][number]['geometry']): Pt[][] {
  if (g.type === 'Polygon') return [g.coordinates[0]];
  if (g.type === 'MultiPolygon') return g.coordinates.map((p: Pt[][]) => p[0]);
  return [];
}

function flat(rings: Pt[][]): number[][] {
  const out: number[][] = [];
  for (const ring of rings) {
    if (ring.every(([, lat]) => lat < -58)) continue; // Antártida
    const s = dp(ring, TOL);
    if (s.length < 4) continue;
    out.push(s.flatMap(([lon, lat]) => [r1(lon), r1(lat)]));
  }
  return out;
}

export async function buildWorld() {
  const land = await cachedJson<FC>(`${NE}/ne_110m_land.geojson`, 'geo/ne_110m_land.geojson');
  const countries = await cachedJson<FC>(`${NE}/ne_110m_admin_0_countries.geojson`, 'geo/ne_110m_admin_0_countries.geojson');
  if (!land || !countries) throw new Error('Natural Earth indisponível');
  const brazil = countries.features.find((f) => f.properties.ISO_A3 === 'BRA');
  if (!brazil) throw new Error('Brasil não encontrado na malha de países');
  const path = join(GEO, 'world.json');
  writeJson(path, { land: flat(land.features.flatMap((f) => outerRings(f.geometry))), br: flat(outerRings(brazil.geometry)) });
  const s = sizes(path);
  console.log(`world.json: ${kb(s.raw)} (${kb(s.gz)} gzip)`);
}

if (isMain(import.meta.url)) await buildWorld();
