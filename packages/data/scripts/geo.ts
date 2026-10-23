// Malhas do IBGE (qualidade mínima) → apps/web/public/geo/uf.json e geo/mun/<UF>.json
// Arredonda para 3 casas, remove pontos repetidos e, se passar do orçamento, simplifica (Douglas-Peucker).
import { join } from 'node:path';
import { UFS, type Municipality } from '@apuracao/shared';
import { MUN_FILE } from './municipalities';
import { cachedJson, GEO, isMain, kb, pool, readJson, sizes, writeJson } from './lib';

const API = 'https://servicodados.ibge.gov.br/api/v3/malhas';
const Q = 'formato=application/vnd.geo+json&qualidade=minima';

export const IBGE_UF: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI',
  '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES',
  '33': 'RJ', '35': 'SP', '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

/** orçamentos em bytes gzip */
const BUDGET_UF = 150 * 1024;
const BUDGET_MUN = 400 * 1024;

type Pt = [number, number];
type Ring = Pt[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Feature = { type: 'Feature'; geometry: { type: string; coordinates: any }; properties: Record<string, unknown> };
type FC = { type: 'FeatureCollection'; features: Feature[] };

const r3 = (x: number) => Math.round(x * 1000) / 1000;

function perpDist(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (!dx && !dy) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / Math.hypot(dx, dy);
}

function dp(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3 || tol <= 0) return pts;
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

function cleanRing(ring: Ring, tol: number): Ring | null {
  const out: Ring = [];
  for (const [x, y] of ring) {
    const p: Pt = [r3(x), r3(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  const s = dp(out, tol);
  // anel fechado precisa de ≥ 4 pontos (3 distintos + fechamento)
  if (s.length < 4) return out.length >= 4 ? out : null;
  return s;
}

function cleanGeometry(g: Feature['geometry'], tol: number): Feature['geometry'] | null {
  if (g.type === 'Polygon') {
    const rings = (g.coordinates as Ring[]).map((r) => cleanRing(r, tol)).filter(Boolean) as Ring[];
    return rings.length ? { type: 'Polygon', coordinates: rings } : null;
  }
  if (g.type === 'MultiPolygon') {
    const polys = (g.coordinates as Ring[][])
      .map((p) => p.map((r) => cleanRing(r, tol)).filter(Boolean) as Ring[])
      .filter((p) => p.length);
    return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
  }
  return g;
}

function cleanFc(fc: FC, props: (f: Feature) => Record<string, unknown>, tol: number): FC {
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => ({
      type: 'Feature',
      properties: props(f),
      // se a simplificação apagar o polígono inteiro, mantém o original arredondado
      geometry: cleanGeometry(f.geometry, tol) ?? cleanGeometry(f.geometry, 0)!,
    })),
  };
}

/** escreve com tolerância crescente até caber no orçamento */
function writeWithin(path: string, build: (tol: number) => FC, budget: number) {
  for (const tol of [0, 0.002, 0.004, 0.008, 0.015, 0.03]) {
    writeJson(path, build(tol));
    const s = sizes(path);
    if (s.gz <= budget) return { ...s, tol };
  }
  const s = sizes(path);
  return { ...s, tol: 0.03 };
}

export async function buildGeo() {
  const report: string[] = [];
  const ufRaw = await cachedJson<FC>(`${API}/paises/BR?${Q}&intrarregiao=UF`, 'geo/br-uf.json');
  if (!ufRaw) throw new Error('malha de UFs não encontrada');
  const ufOut = writeWithin(
    join(GEO, 'uf.json'),
    (tol) => cleanFc(ufRaw, (f) => ({ uf: IBGE_UF[String(f.properties.codarea)] ?? String(f.properties.codarea) }), tol),
    BUDGET_UF,
  );
  report.push(`uf.json: ${kb(ufOut.raw)} (${kb(ufOut.gz)} gzip, tol ${ufOut.tol})`);

  const names = new Map(readJson<Municipality[]>(MUN_FILE).map((m) => [m.ibge, m.name]));
  const ufs = Object.keys(UFS).filter((u) => u !== 'ZZ');
  let missingNames = 0;
  await pool(ufs, 4, async (uf) => {
    const raw = await cachedJson<FC>(`${API}/estados/${uf}?${Q}&intrarregiao=municipio`, `geo/mun-${uf}.json`);
    if (!raw) throw new Error(`malha de ${uf} não encontrada`);
    const out = writeWithin(
      join(GEO, `mun/${uf}.json`),
      (tol) =>
        cleanFc(
          raw,
          (f) => {
            const ibge = String(f.properties.codarea);
            const name = names.get(ibge);
            if (!name && tol === 0) missingNames++;
            return { ibge, name: name ?? ibge };
          },
          tol,
        ),
      BUDGET_MUN,
    );
    report.push(`mun/${uf}.json: ${raw.features.length} municípios, ${kb(out.raw)} (${kb(out.gz)} gzip, tol ${out.tol})`);
  });
  console.log(report.sort().join('\n'));
  if (missingNames) console.warn(`⚠ ${missingNames} polígonos sem nome em municipalities.json`);
}

if (isMain(import.meta.url)) await buildGeo();
