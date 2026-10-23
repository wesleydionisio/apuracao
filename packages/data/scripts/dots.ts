// Mapa "pontilhado": cada cidade recebe 1 ponto a cada ~VPP eleitores, distribuídos numa grade hexagonal
// própria (espaçamento e deslocamento da cidade) dentro do contorno dela. O resultado é uma colcha de
// grades, uma por cidade: densa onde há muita gente, esparsa na Amazônia, e toda cidade aparece.
// Saída: public/data/static/dots.json, já projetado (Mercator) num espaço W×H, para o cliente só escalar.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HistRow, Municipality } from '@apuracao/shared';
import { parseResult } from '@apuracao/shared';
import { GEO, isMain, kb, ROOT, sizes, STATIC, writeJson } from './lib';

type Ring = [number, number][];
type Geom = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };
interface Feature {
  properties: Record<string, string>;
  geometry: Geom | null;
}

const W = 1000;
/** eleitores por ponto: ~6 mil dá uns 27 mil pontos no Brasil */
const VPP = Number(process.env.DOTS_VPP ?? 6000);

/** gerador determinístico (a grade sai igual a cada execução do ETL) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rad = Math.PI / 180;
const merc = ([lon, lat]: [number, number]): [number, number] => [lon * rad, Math.log(Math.tan(Math.PI / 4 + (lat * rad) / 2))];

const polys = (g: Geom): Ring[][] => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

/** par-ímpar sobre todos os anéis: furos funcionam sem saber a orientação */
function inside(x: number, y: number, rings: Ring[]): boolean {
  let c = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i];
      const [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}

/**
 * % do primeiro finalista no confronto direto (×10, -1 sem dado), por cidade, no 1º turno 2026 e no 2º turno 2022.
 * Os finalistas vêm do arquivo do 2º turno do TSE (fixture); o cliente inverte se A/B estiverem trocados.
 */
function refs(list: [string, string][]) {
  const t2 = parseResult(JSON.parse(readFileSync(join(ROOT, 'packages/data/fixtures/t2-br.json'), 'utf8')));
  const n = Object.keys(t2.names).sort((a, b) => t2.names[a].seq - t2.names[b].seq);
  const load = (id: string) => {
    const out = new Map<string, HistRow>();
    for (const uf of new Set(list.map(([, u]) => u))) {
      try {
        const rows = JSON.parse(readFileSync(join(STATIC, 'hist', id, `${uf}.json`), 'utf8')) as Record<string, HistRow>;
        for (const [k, v] of Object.entries(rows)) out.set(k, v);
      } catch {
        /* UF sem histórico */
      }
    }
    return out;
  };
  const share = (rows: Map<string, HistRow>) =>
    list.map(([ibge]) => {
      const h = rows.get(ibge);
      const a = h?.votes[n[0]] ?? 0;
      const b = h?.votes[n[1]] ?? 0;
      return a + b > 0 ? Math.round((a / (a + b)) * 1000) : -1;
    });
  return { n, t1: share(load('t1-2026')), y22: share(load('y2022-t2')) };
}

export async function buildDots() {
  const ufGeo = JSON.parse(readFileSync(join(GEO, 'uf.json'), 'utf8')) as { features: Feature[] };
  const munList = JSON.parse(readFileSync(join(STATIC, 'municipalities.json'), 'utf8')) as Municipality[];
  const elOf = new Map(munList.map((m) => [m.ibge, m.el]));

  // limites do Brasil em Mercator para encaixar em W×H
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const f of ufGeo.features)
    for (const p of polys(f.geometry!))
      for (const r of p)
        for (const c of r) {
          const [x, y] = merc(c);
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
  const k = W / (x1 - x0);
  const H = Math.ceil((y1 - y0) * k);
  const proj = (c: [number, number]): [number, number] => {
    const [x, y] = merc(c);
    return [(x - x0) * k, (y1 - y) * k];
  };

  // municípios projetados, com caixa envolvente
  interface Mun { ibge: string; uf: string; rings: Ring[]; bb: [number, number, number, number] }
  const muns: Mun[] = [];
  const ufPaths: Record<string, string> = {};
  for (const f of ufGeo.features) {
    const uf = f.properties.uf;
    ufPaths[uf] = polys(f.geometry!)
      .map((p) => p.map((r) => 'M' + r.map((c) => proj(c).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z').join(''))
      .join('');
    const g = JSON.parse(readFileSync(join(GEO, 'mun', `${uf}.json`), 'utf8')) as { features: Feature[] };
    for (const mf of g.features) {
      if (!mf.geometry) continue;
      const rings = polys(mf.geometry).flat().map((r) => r.map(proj));
      let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
      for (const r of rings) for (const [x, y] of r) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
      muns.push({ ibge: mf.properties.ibge, uf, rings, bb: [bx0, by0, bx1, by1] });
    }
  }

  // pontos de cada cidade: grade hexagonal própria, com espaçamento ajustado até dar ~N pontos dentro dela
  const pts: number[] = [];
  let fallback = 0;
  muns.forEach((m, i) => {
    const n = Math.max(1, Math.round((elOf.get(m.ibge) ?? 0) / VPP));
    const [bx0, by0, bx1, by1] = m.bb;
    const r = rng(Number(m.ibge) || i + 1);
    const ox = r();
    const oy = r();
    let step = Math.sqrt(((bx1 - bx0) * (by1 - by0) * 0.6) / n) || 1;
    let best: [number, number][] = [];
    for (let it = 0; it < 14; it++) {
      const got: [number, number][] = [];
      const dy = (step * Math.sqrt(3)) / 2;
      for (let j = 0, y = by0 + oy * dy; y <= by1; j++, y += dy)
        for (let x = bx0 + ((ox + (j % 2) * 0.5) % 1) * step; x <= bx1; x += step) if (inside(x, y, m.rings)) got.push([x, y]);
      if (Math.abs(got.length - n) < Math.abs(best.length - n) || !best.length) best = got;
      if (got.length >= n * 0.85 && got.length <= n * 1.15) break;
      step *= got.length < n ? 0.82 : 1.12;
    }
    if (!best.length) {
      // cidade minúscula: o centro do maior anel (ou o primeiro vértice, se o centro cair fora)
      const big = m.rings.reduce((a2, b2) => (b2.length > a2.length ? b2 : a2));
      let cx = big.reduce((s2, c) => s2 + c[0], 0) / big.length;
      let cy = big.reduce((s2, c) => s2 + c[1], 0) / big.length;
      if (!inside(cx, cy, m.rings)) [cx, cy] = big[0];
      best = [[cx, cy]];
      fallback++;
    }
    for (const [x, y] of best) pts.push(Math.round(x * 10), Math.round(y * 10), i);
  });

  const out = {
    v: 1,
    w: W,
    h: H,
    vpp: VPP,
    /** município por índice (IBGE), UF e eleitorado; `pts` é [x×10, y×10, índice] em sequência */
    mun: muns.map((m) => m.ibge),
    uf: muns.map((m) => m.uf),
    el: muns.map((m) => elOf.get(m.ibge) ?? 0),
    pts,
    ufPaths,
    ref: refs(muns.map((m) => [m.ibge, m.uf])),
  };
  const file = join(STATIC, 'dots.json');
  writeJson(file, out);
  const sz = sizes(file);
  console.log(`  ${pts.length / 3} pontos, 1 a cada ~${VPP} eleitores (${fallback} cidades minúsculas com ponto no centro), ${muns.length} cidades, ${W}×${H}, ${kb(sz.raw)} (${kb(sz.gz)} gzip)`);
}

if (isMain(import.meta.url)) await buildDots();
