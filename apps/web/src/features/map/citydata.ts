// Dados dos mapas por cidade, compartilhados por todos os mapas do site: os ~27 mil pontos (dots.json), o
// % apurado e o % de A de cada cidade (mungrid.json ao vivo; 1º turno e 2022 vêm no próprio dots.json) e a
// grade hexagonal em quatro tamanhos, montada uma vez só num worker.
import type { Board } from '@apuracao/shared';
import { useEffect, useMemo, useState } from 'react';
import { getJSON } from '@/lib/api';
import { hash01, type HexLevel } from './hex';
import type { HexReply, HexRequest } from './hex.worker';

export type DotLayer = 'live' | 't1' | 'y2022';

export interface DotsFile {
  w: number;
  h: number;
  vpp: number;
  mun: string[];
  uf: string[];
  el: number[];
  /** [x×10, y×10, índice da cidade] em sequência */
  pts: number[];
  ufPaths: Record<string, string>;
  /** % do primeiro finalista (ref.n[0]) ×10 no confronto direto; -1 sem dado */
  ref: { n: string[]; t1: number[]; y22: number[] };
}

/** /data/mungrid.json: [% apurado ×10] e [% de A ×10 ou -1], na ordem de `mun` */
interface Grid {
  at: string | null;
  p: number[];
  a: number[];
}

/** por índice de cidade: % apurado e % de A (NaN sem votos) */
export type Values = { pst: Float32Array; pa: Float32Array };

/** raio do hexágono (unidades do mapa) em cada nível: ~55, 28, 14 e 7 km de largura */
export const RADII = [6.5, 3.25, 1.625, 0.8125];

let dotsP: Promise<DotsFile> | null = null;
const loadDots = () => (dotsP ??= getJSON<DotsFile>('/data/static/dots.json'));

export function useDots() {
  const [dots, setDots] = useState<DotsFile | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadDots().then(
      (d) => alive && setDots(d),
      () => {
        dotsP = null;
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return { dots, failed };
}

export interface DotGeo {
  n: number;
  x: Float32Array;
  y: Float32Array;
  m: Uint16Array;
  perCity: Uint16Array;
  /** contorno de todos os estados num caminho só, e o de cada UF */
  outline: Path2D;
  ufOutline: Record<string, Path2D>;
  /** caixa de cada UF em unidades do mapa [x0, y0, x1, y1] */
  ufBox: Record<string, [number, number, number, number]>;
  /** índice da cidade por código IBGE */
  byIbge: Map<string, number>;
}

const geoCache = new WeakMap<DotsFile, DotGeo>();

/** geometria fixa por ponto e por UF, calculada uma vez por arquivo */
export function dotGeo(dots: DotsFile): DotGeo {
  let g = geoCache.get(dots);
  if (g) return g;
  const n = dots.pts.length / 3;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const m = new Uint16Array(n);
  const perCity = new Uint16Array(dots.mun.length);
  for (let i = 0; i < n; i++) {
    x[i] = dots.pts[i * 3] / 10;
    y[i] = dots.pts[i * 3 + 1] / 10;
    m[i] = dots.pts[i * 3 + 2];
    perCity[m[i]]++;
  }
  const ufOutline: Record<string, Path2D> = {};
  const ufBox: Record<string, [number, number, number, number]> = {};
  for (const [uf, d] of Object.entries(dots.ufPaths)) {
    ufOutline[uf] = new Path2D(d);
    const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      b[0] = Math.min(b[0], nums[i]);
      b[1] = Math.min(b[1], nums[i + 1]);
      b[2] = Math.max(b[2], nums[i]);
      b[3] = Math.max(b[3], nums[i + 1]);
    }
    ufBox[uf] = b;
  }
  const outline = new Path2D(Object.values(dots.ufPaths).join(''));
  const byIbge = new Map(dots.mun.map((ibge, i) => [ibge, i]));
  g = { n, x, y, m, perCity, outline, ufOutline, ufBox, byIbge };
  geoCache.set(dots, g);
  return g;
}

/** % apurado e % de A por cidade, para a camada escolhida (`enabled` falso: nada, nem busca) */
export function useCityValues(dots: DotsFile | null, layer: DotLayer, board: Board | null, enabled = true): Values | null {
  const [grid, setGrid] = useState<Grid | null>(null);
  const at = board?.source.at;
  useEffect(() => {
    if (!enabled || layer !== 'live' || !board?.released) return;
    let alive = true;
    const load = () =>
      // sem query de cache-buster: a URL fixa deixa a CDN segurar o arquivo (s-maxage=5)
      getJSON<Grid>('/data/mungrid.json', { cache: 'no-store' })
        .then((g) => alive && setGrid(g))
        .catch(() => {});
    load();
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enabled, layer, board?.released, at]);

  return useMemo(() => {
    if (!enabled || !dots || !board) return null;
    const n = dots.mun.length;
    const pst = new Float32Array(n);
    const pa = new Float32Array(n).fill(NaN);
    const [ca] = board.candidates;
    if (layer === 'live') {
      if (!grid || grid.p.length !== n) return { pst, pa };
      for (let i = 0; i < n; i++) {
        pst[i] = grid.p[i] / 10;
        if (grid.a[i] >= 0) pa[i] = grid.a[i] / 10;
      }
    } else {
      // referências: tudo "apurado"; o arquivo guarda o % do primeiro finalista, A pode ser o outro
      const src = layer === 't1' ? dots.ref.t1 : dots.ref.y22;
      const aNum = layer === 't1' ? ca.n : board.y2022Map.a;
      const flip = aNum !== dots.ref.n[0];
      for (let i = 0; i < n; i++) {
        pst[i] = 100;
        if (src[i] >= 0) pa[i] = flip ? 100 - src[i] / 10 : src[i] / 10;
      }
    }
    return { pst, pa };
  }, [enabled, dots, board, layer, grid]);
}

// A grade sai de um worker (o nível mais fino tem ~200 mil hexágonos e uma busca em largura) e fica guardada:
// todos os mapas da sessão usam a mesma.
let levelsP: Promise<HexLevel[]> | null = null;

function buildLevels(dots: DotsFile, geo: DotGeo): Promise<HexLevel[]> {
  return (levelsP ??= new Promise<HexLevel[]>((resolve, reject) => {
    // contorno do Brasil rasterizado, 1 byte por unidade do mapa: quais hexágonos vazios estão em terra
    const mw = dots.w;
    const mh = Math.ceil(dots.h);
    const mc = document.createElement('canvas');
    mc.width = mw;
    mc.height = mh;
    const mx = mc.getContext('2d', { willReadFrequently: true })!;
    mx.fill(geo.outline);
    const px = mx.getImageData(0, 0, mw, mh).data;
    const mask = new Uint8Array(mw * mh);
    for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 100 ? 1 : 0;
    const w = new Worker(new URL('./hex.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<HexReply>) => {
      resolve(e.data.levels);
      w.terminate();
    };
    w.onerror = (e) => {
      levelsP = null;
      reject(e);
      w.terminate();
    };
    w.postMessage(
      { pts: { n: geo.n, x: geo.x, y: geo.y, m: geo.m, perCity: geo.perCity }, el: dots.el, mask, mw, mh, radii: RADII } satisfies HexRequest,
      [mask.buffer],
    );
  }));
}

export function useHexLevels(dots: DotsFile | null): HexLevel[] | null {
  const [levels, setLevels] = useState<HexLevel[] | null>(null);
  useEffect(() => {
    if (!dots) return;
    let alive = true;
    buildLevels(dots, dotGeo(dots)).then(
      (l) => alive && setLevels(l),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [dots]);
  return levels;
}

/** sorteios fixos por ponto do modo pontos (ordem de acender, cor, atraso, ordem de pintura) */
export function dotDraws(n: number) {
  const order = new Float32Array(n);
  const coin = new Float32Array(n);
  const delay = new Float32Array(n);
  const shuffle = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    order[i] = hash01(i, 1) * 100;
    coin[i] = hash01(i, 2) * 100;
    delay[i] = hash01(i, 3);
    shuffle[i] = hash01(i, 4);
  }
  const perm = Uint32Array.from({ length: n }, (_, i) => i).sort((a, b) => shuffle[a] - shuffle[b]);
  return { order, coin, delay, perm };
}
