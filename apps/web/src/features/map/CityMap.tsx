// Mapa por cidade em dois modos, sobre os mesmos ~27 mil pontos de dots.json (1 a cada ~6 mil eleitores,
// cada um preso à sua cidade):
//  - grade: o Brasil em hexágonos do mesmo tamanho (hex.ts), na cor de quem lidera ali, em três tons pela
//    vantagem; o hexágono cresce de um ponto apagado até o tamanho cheio conforme a região é apurada;
//  - pontos: cada ponto acende quando o % apurado da cidade passa do sorteio dele e fica vermelho ou azul
//    na proporção dos votos da cidade (pontilhismo).
// Canvas 2D (svg com dezenas de milhares de nós travaria um celular barato), com zoom e arrasto
// (viewport.ts). Só redesenha quando chega dado novo, durante uma transição ou quando a vista muda.
import type { Board, CandidateDef } from '@apuracao/shared';
import { fmtPct } from '@apuracao/shared';
import { ChevronRight, Maximize2, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { getJSON, type CityView } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { useThemeColors } from './colors';
import { bandOfMargin, hash01, HEX_X, HEX_Y, hexPath, hexUnder, hexValues, rgbCss, shades, toRgb, type HexLevel } from './hex';
import type { HexReply, HexRequest } from './hex.worker';
import { reduceMotion, useViewport } from './viewport';

export type DotLayer = 'live' | 't1' | 'y2022';
export type CityMapMode = 'hex' | 'dots';

interface DotsFile {
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

type Values = { pst: Float32Array; pa: Float32Array };

let dotsP: Promise<DotsFile> | null = null;
const loadDots = () => (dotsP ??= getJSON<DotsFile>('/data/static/dots.json'));

/** pontos coloridos por lote de pintura (ver `paint` no modo pontos) */
const LOT = 256;

/** raio do hexágono (unidades do mapa) em cada nível: ~55 km, ~28 km e ~14 km de largura */
const RADII = [6.5, 3.25, 1.625];
/** zoom a partir do qual entra cada nível mais fino (o hexágono na tela fica sempre entre ~4 e ~12 px) */
const LEVEL_AT = [2.1, 4.3];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const coarse = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const ease = (t: number) => 1 - (1 - t) ** 3;

/** % apurado e % de A por cidade, para a camada escolhida */
function useCityValues(dots: DotsFile | null, layer: DotLayer, board: Board | null): Values | null {
  const [grid, setGrid] = useState<Grid | null>(null);
  const at = board?.source.at;
  useEffect(() => {
    if (layer !== 'live' || !board?.released) return;
    let alive = true;
    const load = () =>
      getJSON<Grid>(`/data/mungrid.json?t=${Date.now()}`, { cache: 'no-store' })
        .then((g) => alive && setGrid(g))
        .catch(() => {});
    load();
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [layer, board?.released, at]);

  return useMemo(() => {
    if (!dots || !board) return null;
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
  }, [dots, board, layer, grid]);
}

/** ruído suave no espaço do mapa (0..1): a transição anda em ondas, não pisca tudo junto */
function noise2(x: number, y: number, step = 70): number {
  const fx = x / step;
  const fy = y / step;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const sx = (fx - ix) ** 2 * (3 - 2 * (fx - ix));
  const sy = (fy - iy) ** 2 * (3 - 2 * (fy - iy));
  const v = (i: number, j: number) => hash01(i * 7919 + j * 104729, 9);
  const a = v(ix, iy) + (v(ix + 1, iy) - v(ix, iy)) * sx;
  const b = v(ix, iy + 1) + (v(ix + 1, iy + 1) - v(ix, iy + 1)) * sx;
  return a + (b - a) * sy;
}

/** um nível da grade em transição: de onde vem e para onde vai cada hexágono (% de A e fração apurada) */
interface LevelView {
  L: HexLevel;
  fs: Float32Array;
  fq: Float32Array;
  ts: Float32Array;
  tq: Float32Array;
  delay: Float32Array;
}

interface HexState {
  levels: LevelView[];
  t0: number;
  dur: number;
}

/** % de A e fração apurada de um hexágono no instante `now` */
function shownAt(st: HexState, lv: LevelView, h: number, now: number): [number, number] {
  const t = st.dur ? (now - st.t0) / st.dur : 1;
  const e = ease(Math.min(1, Math.max(0, (t - lv.delay[h] * 0.45) / 0.55)));
  return [lv.fs[h] + (lv.ts[h] - lv.fs[h]) * e, lv.fq[h] + (lv.tq[h] - lv.fq[h]) * e];
}

export default function CityMap({
  mode,
  layer,
  cands,
  className,
}: {
  mode: CityMapMode;
  layer: DotLayer;
  cands: CandidateDef[];
  className?: string;
}) {
  const board = useBoard((s) => s.board);
  const [dots, setDots] = useState<DotsFile | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    loadDots().then(setDots, () => setFailed(true));
  }, []);
  const values = useCityValues(dots, layer, board);
  const theme = useThemeColors();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cssW, setCssW] = useState(0);
  const cssH = dots && cssW ? (cssW * dots.h) / dots.w : 0;
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCssW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // geometria fixa por ponto: posição, cidade e os sorteios do modo pontos
  const geo = useMemo(() => {
    if (!dots) return null;
    const n = dots.pts.length / 3;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    const m = new Uint16Array(n);
    const order = new Float32Array(n); // acende quando % apurado da cidade passa disto
    const coin = new Float32Array(n); // cor: A se coin < % de A
    const delay = new Float32Array(n); // atraso da animação ao acender
    const shuffle = new Float32Array(n); // ordem de pintura
    const perCity = new Uint16Array(dots.mun.length);
    for (let i = 0; i < n; i++) {
      x[i] = dots.pts[i * 3] / 10;
      y[i] = dots.pts[i * 3 + 1] / 10;
      m[i] = dots.pts[i * 3 + 2];
      order[i] = hash01(i, 1) * 100;
      coin[i] = hash01(i, 2) * 100;
      delay[i] = hash01(i, 3);
      shuffle[i] = hash01(i, 4);
      perCity[m[i]]++;
    }
    const perm = Uint32Array.from({ length: n }, (_, i) => i).sort((a, b) => shuffle[a] - shuffle[b]);
    // índice espacial para o toque no modo pontos: baldes de 12 unidades
    const B = 12;
    const bins = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const k = Math.floor(x[i] / B) * 10_000 + Math.floor(y[i] / B);
      (bins.get(k) ?? bins.set(k, []).get(k)!).push(i);
    }
    // contorno de todos os estados num caminho só: máscara da grade e divisas
    const outline = new Path2D(Object.values(dots.ufPaths).join(''));
    return { n, x, y, m, order, coin, delay, perm, bins, B, outline, perCity };
  }, [dots]);

  const pal = useMemo(() => {
    const card = toRgb(theme.card);
    const dark = 0.2126 * card[0] + 0.7152 * card[1] + 0.0722 * card[2] < 110;
    const a = shades(toRgb(cands[0].color)).map(rgbCss);
    const b = shades(toRgb(cands[1].color)).map(rgbCss);
    return { a, b, dark };
  }, [cands, theme]);

  // um laço de desenho só: cada mudança (dado, vista, tema) pede um quadro; transições pedem os seguintes
  const frame = useRef<(now: number) => boolean>(() => false);
  const rafId = useRef(0);
  const kick = useCallback(() => {
    if (rafId.current) return;
    const loop = (now: number) => {
      rafId.current = 0;
      if (frame.current(now)) rafId.current = requestAnimationFrame(loop);
    };
    rafId.current = requestAnimationFrame(loop);
  }, []);
  useEffect(() => () => cancelAnimationFrame(rafId.current), []);

  // grade hexagonal: os três níveis saem de um worker (o mais fino tem ~50 mil hexágonos)
  const [levels, setLevels] = useState<HexLevel[] | null>(null);
  useEffect(() => {
    if (!geo || !dots) return;
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
    w.onmessage = (e: MessageEvent<HexReply>) => setLevels(e.data.levels);
    w.postMessage(
      { pts: { n: geo.n, x: geo.x, y: geo.y, m: geo.m, perCity: geo.perCity }, el: dots.el, mask, mw, mh, radii: RADII } satisfies HexRequest,
      [mask.buffer],
    );
    return () => w.terminate();
  }, [geo, dots]);

  // toque/clique → cidade
  const onTap = (tx: number, ty: number) => {
    if (!geo || !dots || !cssW) return;
    const { k, x, y } = vp.v.current;
    const s = (cssW / dots.w) * k;
    const px = (tx - x) / s;
    const py = (ty - y) / s;
    if (mode === 'hex' && levels) {
      const L = levels[k < LEVEL_AT[0] ? 0 : k < LEVEL_AT[1] ? 1 : 2];
      const h = hexUnder(L, px, py);
      setPicked(h >= 0 && L.city[h] >= 0 ? L.city[h] : null);
      return;
    }
    const reach = 14 / s;
    let best = -1;
    let bestD = reach * reach;
    const bx = Math.floor(px / geo.B);
    const by = Math.floor(py / geo.B);
    const span = Math.ceil(reach / geo.B);
    for (let ix = bx - span; ix <= bx + span; ix++)
      for (let iy = by - span; iy <= by + span; iy++)
        for (const i of geo.bins.get(ix * 10_000 + iy) ?? []) {
          const d = (geo.x[i] - px) ** 2 + (geo.y[i] - py) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
    setPicked(best >= 0 ? geo.m[best] : null);
  };
  const vp = useViewport(canvas, cssW, cssH, kick, onTap);

  const lastMode = useRef<CityMapMode | null>(null);

  // modo pontos: quando cada ponto acendeu (para a cascata); ao entrar no modo, tudo acende de novo
  const litAt = useRef<Float64Array | null>(null);
  const until = useRef(0);
  useEffect(() => {
    if (!geo || !values || mode !== 'dots') return;
    const now0 = performance.now();
    const calm = reduceMotion();
    if (!litAt.current || litAt.current.length !== geo.n || lastMode.current !== 'dots') litAt.current = new Float64Array(geo.n).fill(-1);
    const L = litAt.current;
    let end = now0;
    for (let i = 0; i < geo.n; i++) {
      const lit = geo.order[i] < values.pst[geo.m[i]];
      if (lit && L[i] < 0) {
        // acende em cascata ao longo de ~1,2s (sem animação se o sistema pede menos movimento)
        L[i] = calm ? now0 : now0 + geo.delay[i] * 1200;
        end = Math.max(end, L[i]);
      } else if (!lit) L[i] = -1;
    }
    until.current = end;
    kick();
  }, [geo, values, mode, kick]);

  // modo grade: a cada dado, cada hexágono transiciona do que está na tela para o novo valor
  const hex = useRef<HexState | null>(null);
  useEffect(() => {
    if (!levels || !values || !geo || !dots || mode !== 'hex') return;
    const now = performance.now();
    const st = hex.current;
    // ao entrar no modo (ou com grade nova) os hexágonos nascem apagados e crescem
    const enter = !st || st.levels[0].L !== levels[0] || lastMode.current !== 'hex';
    const next = levels.map((L, li) => {
      const { share, prog } = hexValues(L, geo, dots.el, values.pst, values.pa);
      const prev = enter ? null : st!.levels[li];
      const n = L.n;
      const fs = new Float32Array(n);
      const fq = new Float32Array(n);
      const ts = new Float32Array(n);
      const tq = new Float32Array(n);
      for (let h = 0; h < n; h++) {
        const known = !Number.isNaN(share[h]);
        if (prev) [fs[h], fq[h]] = shownAt(st!, prev, h, now);
        else fs[h] = known ? share[h] : 50;
        ts[h] = known ? share[h] : fs[h];
        tq[h] = known ? prog[h] : 0;
      }
      const delay = prev?.delay ?? Float32Array.from({ length: n }, (_, h) => 0.7 * noise2(L.cx[h], L.cy[h]) + 0.3 * hash01(h, 5));
      return { L, fs, fq, ts, tq, delay };
    });
    hex.current = { levels: next, t0: now, dur: reduceMotion() ? 0 : enter ? 1700 : 900 };
    kick();
  }, [levels, values, geo, dots, mode, kick]);

  useEffect(() => {
    lastMode.current = mode;
  }, [mode]);

  // desenho de um quadro, com a vista atual
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !geo || !values || !dots || !cssW) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(cssW * dpr);
    const H = Math.round(cssH * dpr);
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    const ctx = cv.getContext('2d')!;
    const s0 = cssW / dots.w;
    const [ca, cb] = cands;
    const pickedM = picked;
    // brilho do tema escuro: a imagem reduzida 6× e ampliada de volta vira um halo macio atrás dos hexágonos
    const glow = document.createElement('canvas');
    glow.width = Math.ceil(W / 6);
    glow.height = Math.ceil(H / 6);
    const gctx = glow.getContext('2d')!;
    // raio em px de tela no modo pontos: ~1px no celular, ~1,8px no desktop
    const base = Math.max(0.8, Math.min(1.8, cssW / 520));

    const drawHex = (now: number, s: number, k: number, vx: number, vy: number) => {
      const st = hex.current;
      if (!st) return false;
      const li = k < LEVEL_AT[0] ? 0 : k < LEVEL_AT[1] ? 1 : 2;
      const lv = st.levels[li];
      const { L } = lv;
      const R = L.R;
      // só o que está na tela
      const x0 = -vx / s - R;
      const y0 = -vy / s - R;
      const x1 = (cssW - vx) / s + R;
      const y1 = (cssH - vy) / s + R;
      const sel = pickedM !== null;
      // 0–2 tons de A, 3–5 tons de B; um conjunto para o mapa e outro para a cidade escolhida
      const fills = Array.from({ length: 6 }, () => new Path2D());
      const fillsSel = Array.from({ length: 6 }, () => new Path2D());
      const off = new Path2D();
      const offSel = new Path2D();
      const ring = new Path2D();
      for (let h = 0; h < L.n; h++) {
        const x = L.cx[h];
        const y = L.cy[h];
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        const mine = sel && L.city[h] === pickedM;
        const [sh, q] = shownAt(st, lv, h, now);
        if (mine) hexPath(ring, x, y, R * 0.97);
        if (q < 0.015) {
          // ainda sem votos: um ponto apagado marca o lugar do hexágono
          hexPath(mine ? offSel : off, x, y, R * 0.2);
          continue;
        }
        // cresce de ~1/3 até 92% do raio conforme a região é apurada (o resto é o vão entre hexágonos)
        const r = R * (0.32 + 0.6 * Math.sqrt(q));
        const i = (sh >= 50 ? 0 : 3) + bandOfMargin(Math.abs(2 * sh - 100));
        hexPath((mine ? fillsSel : fills)[i], x, y, r);
      }
      const paint = (f: Path2D[], o: Path2D, alpha: number) => {
        ctx.fillStyle = theme.foreground;
        ctx.globalAlpha = 0.16 * alpha;
        ctx.fill(o);
        ctx.globalAlpha = alpha;
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = i < 3 ? pal.a[i] : pal.b[i - 3];
          ctx.fill(f[i]);
        }
      };
      // a cidade escolhida ganha só um contorno claro por cima; o resto do mapa não muda
      paint(fills, off, 1);
      if (sel) paint(fillsSel, offSel, 1);
      ctx.globalAlpha = 1;
      if (pal.dark) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        gctx.clearRect(0, 0, glow.width, glow.height);
        gctx.drawImage(cv, 0, 0, glow.width, glow.height);
        ctx.globalCompositeOperation = 'destination-over';
        ctx.globalAlpha = 0.55;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(glow, 0, 0, W, H);
        ctx.restore();
      }
      // divisas dos estados, discretas
      ctx.lineWidth = 0.8 / s;
      ctx.strokeStyle = theme.foreground;
      ctx.globalAlpha = 0.22;
      ctx.stroke(geo.outline);
      if (sel) {
        ctx.lineWidth = 1.5 / s;
        ctx.globalAlpha = 1;
        ctx.stroke(ring);
      }
      ctx.globalAlpha = 1;
      return st.dur > 0 && now - st.t0 < st.dur;
    };

    const drawDots = (now: number, s: number, k: number, vx: number, vy: number) => {
      const L = litAt.current;
      if (!L) return false;
      // contorno dos estados, discreto, só para situar
      ctx.lineWidth = 0.6 / s;
      ctx.strokeStyle = theme.border;
      ctx.stroke(geo.outline);
      // os pontos crescem com o zoom (até 5 px) para dar para ver um a um; apagado é menor
      const rPx = Math.min(5, base * Math.sqrt(k));
      const r = rPx / s;
      const rOff = r * 0.55;
      const square = rPx < 1.25; // abaixo disso quadrado e círculo são iguais na tela, e quadrado é bem mais rápido
      // só o que está na tela
      const x0 = -vx / s - r;
      const y0 = -vy / s - r;
      const x1 = (cssW - vx) / s + r;
      const y1 = (cssH - vy) / s + r;
      const dot = (p: Path2D, x: number, y: number, rr: number) => {
        if (square) p.rect(x - rr, y - rr, rr * 2, rr * 2);
        else {
          p.moveTo(x + rr, y);
          p.arc(x, y, rr, 0, Math.PI * 2);
        }
      };
      // Numa capital dezenas de pontos caem no mesmo pixel. Se todo o vermelho fosse pintado antes de todo o
      // azul, o azul cobriria a cidade inteira. Pintando em ordem embaralhada e em lotes pequenos, cada pixel
      // fica com a cor do último ponto que caiu nele: vermelho ou azul na proporção certa.
      const paint = (only: (mi: number) => boolean, alpha: number, rUnlit: number) => {
        const off = new Path2D();
        const wait = new Path2D(); // apurado, votos ainda não chegaram
        const lots: [Path2D, Path2D][] = [];
        let lot: [Path2D, Path2D] = [new Path2D(), new Path2D()];
        let c = 0;
        for (let j = 0; j < geo.n; j++) {
          const i = geo.perm[j];
          const mi = geo.m[i];
          const x = geo.x[i];
          const y = geo.y[i];
          if (x < x0 || x > x1 || y < y0 || y > y1 || !only(mi)) continue;
          if (L[i] < 0 || L[i] > now) {
            dot(off, x, y, rUnlit);
            continue;
          }
          const share = values.pa[mi];
          if (Number.isNaN(share)) {
            dot(wait, x, y, r);
            continue;
          }
          if (c++ % LOT === 0) lots.push((lot = [new Path2D(), new Path2D()]));
          dot(geo.coin[i] < share ? lot[0] : lot[1], x, y, r);
        }
        // globalAlpha fora de 0..1 é ignorado pelo canvas, por isso o min
        ctx.fillStyle = theme.foreground;
        ctx.globalAlpha = Math.min(1, 0.14 * alpha);
        ctx.fill(off);
        ctx.globalAlpha = Math.min(1, 0.45 * alpha);
        ctx.fill(wait);
        ctx.globalAlpha = Math.min(1, alpha);
        for (const [a, b] of lots) {
          ctx.fillStyle = ca.color;
          ctx.fill(a);
          ctx.fillStyle = cb.color;
          ctx.fill(b);
        }
      };
      if (pickedM === null) paint(() => true, 1, rOff);
      else {
        // cidade escolhida acesa por cima, o resto esmaecido; os apagados dela ficam bem visíveis (0,14→0,31)
        paint((mi) => mi !== pickedM, 0.28, rOff);
        paint((mi) => mi === pickedM, 1 / 0.45, r * 0.8);
      }
      ctx.globalAlpha = 1;
      return now < until.current;
    };

    frame.current = (now: number) => {
      const { k, x, y } = vp.v.current;
      const s = s0 * k;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * x, dpr * y);
      return mode === 'hex' ? drawHex(now, s, k, x, y) : drawDots(now, s, k, x, y);
    };
    kick();
  }, [geo, values, dots, cssW, cssH, theme, pal, cands, picked, mode, kick, vp.v]);

  const stats = useMemo(() => {
    if (!values || !dots) return null;
    let started = 0;
    let done = 0;
    for (let i = 0; i < dots.mun.length; i++) {
      if (values.pst[i] > 0) started++;
      if (values.pst[i] >= 100) done++;
    }
    return { started, done, total: dots.mun.length };
  }, [values, dots]);

  if (failed) return <p className="py-10 text-center text-sm text-muted-foreground">Não foi possível carregar o mapa.</p>;

  const what = mode === 'hex' ? 'Mapa do Brasil em hexágonos' : 'Mapa de pontos do Brasil';
  return (
    <div className={cn('w-full', className)}>
      <div ref={wrap} className="relative w-full overflow-hidden rounded-xl">
        {!dots && <div className="aspect-[1000/1051] w-full animate-pulse rounded-xl bg-muted/60" />}
        <canvas
          ref={canvas}
          tabIndex={0}
          {...vp.bind}
          className={cn(
            'block w-full select-none focus-visible:outline-offset-[-2px]',
            vp.zoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
            !dots && 'hidden',
          )}
          // sem zoom, um dedo rola a página; com zoom, arrasta o mapa
          style={{ height: cssH || undefined, touchAction: vp.zoomed ? 'none' : 'pan-y' }}
          role="img"
          aria-label={
            stats
              ? `${what}: ${stats.started} de ${stats.total} cidades com apuração iniciada, ${stats.done} completas. Toque para ver uma cidade; + e − aproximam e afastam.`
              : what
          }
        />
        {dots && <ZoomControls zoomed={vp.zoomed} onIn={() => vp.zoomBy(2)} onOut={() => vp.zoomBy(0.5)} onReset={vp.reset} />}
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-3 flex justify-center transition-opacity duration-200',
            vp.hint ? 'opacity-100' : 'opacity-0',
          )}
        >
          <span className="rounded-full bg-foreground/85 px-3 py-1.5 text-[12px] text-background">
            {isMac ? '⌘' : 'Ctrl'} + rolagem para dar zoom
          </span>
        </div>
      </div>
      <Legend mode={mode} cands={cands} pal={pal} vpp={dots?.vpp ?? 6000} layer={layer} stats={stats} />
      <PickedCity m={picked} dots={dots} values={values} cands={cands} onClose={() => setPicked(null)} />
    </div>
  );
}

function ZoomControls({ zoomed, onIn, onOut, onReset }: { zoomed: boolean; onIn: () => void; onOut: () => void; onReset: () => void }) {
  // canto de baixo à esquerda: lá o enquadramento do Brasil é vazio (Paraguai/Argentina). Alvo de 44px, botão de 32px
  const btn = 'group grid size-11 place-items-center disabled:pointer-events-none';
  const face =
    'grid size-8 place-items-center rounded-lg border bg-card/90 text-foreground shadow-sm backdrop-blur-sm transition-opacity group-active:scale-95 group-disabled:opacity-40';
  return (
    <div className="absolute bottom-0 left-0 flex flex-col" role="group" aria-label="Zoom do mapa">
      <button type="button" className={btn} onClick={onIn} aria-label="Aproximar">
        <span className={face}>
          <Plus className="size-4" aria-hidden />
        </span>
      </button>
      <button type="button" className={btn} onClick={onOut} disabled={!zoomed} aria-label="Afastar">
        <span className={face}>
          <Minus className="size-4" aria-hidden />
        </span>
      </button>
      <button type="button" className={btn} onClick={onReset} disabled={!zoomed} aria-label="Ver o Brasil inteiro">
        <span className={face}>
          <Maximize2 className="size-3.5" aria-hidden />
        </span>
      </button>
    </div>
  );
}

/** hexágono da legenda, com vértice para cima como no mapa */
function Hex({ color, size = 12, opacity }: { color: string; size?: number; opacity?: number }) {
  const pts = HEX_X.map((x, k) => `${(x * 0.98).toFixed(3)},${(HEX_Y[k] * 0.98).toFixed(3)}`).join(' ');
  return (
    <svg viewBox="-1 -1 2 2" width={size} height={size} aria-hidden className="shrink-0">
      <polygon points={pts} fill={color} opacity={opacity} />
    </svg>
  );
}

function Legend({
  mode,
  cands,
  pal,
  vpp,
  layer,
  stats,
}: {
  mode: CityMapMode;
  cands: CandidateDef[];
  pal: { a: string[]; b: string[] };
  vpp: number;
  layer: DotLayer;
  stats: { started: number; done: number; total: number } | null;
}) {
  const [ca, cb] = cands;
  const live = layer === 'live';
  const sw = (bg: string, op = 1) => <span className="inline-block size-2 rounded-full" style={{ background: bg, opacity: op }} aria-hidden />;
  const progress =
    live && stats
      ? ` ${stats.started.toLocaleString('pt-BR')} de ${stats.total.toLocaleString('pt-BR')} cidades com apuração iniciada, ${stats.done.toLocaleString('pt-BR')} completas.`
      : '';
  // as duas legendas no mesmo lugar, só a do modo ativo visível: trocar de modo não muda a altura
  return (
    <div className="mt-3 grid text-center text-[12px] text-muted-foreground [&>*]:col-start-1 [&>*]:row-start-1">
      <div className={cn('space-y-2', mode !== 'hex' && 'invisible')} aria-hidden={mode !== 'hex'}>
        <div className="flex items-center justify-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="flex gap-0.5">
              {pal.a.map((c) => (
                <Hex key={c} color={c} />
              ))}
            </span>
            {ca.short}
          </span>
          <span className="inline-flex items-center gap-1.5">
            {cb.short}
            <span className="flex gap-0.5">
              {[...pal.b].reverse().map((c) => (
                <Hex key={c} color={c} />
              ))}
            </span>
          </span>
        </div>
        <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-pretty">
          <span>Tom mais vivo, vantagem maior.</span>
          {live && (
            <span className="inline-flex items-center gap-1">
              O hexágono cresce
              <span className="inline-flex items-end gap-0.5">
                <Hex color="currentColor" size={5} opacity={0.5} />
                <Hex color="currentColor" size={8} opacity={0.7} />
                <Hex color="currentColor" size={11} />
              </span>
              conforme a região é apurada.
            </span>
          )}
          {progress && <span>{progress.trim()}</span>}
        </p>
      </div>
      <div className={cn('space-y-1.5', mode !== 'dots' && 'invisible')} aria-hidden={mode !== 'dots'}>
        <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1">
            {sw(ca.color)} {ca.short}
          </span>
          <span className="inline-flex items-center gap-1">
            {sw(cb.color)} {cb.short}
          </span>
          {live && (
            <span className="inline-flex items-center gap-1">
              {sw('var(--foreground)', 0.2)} ainda não apurado
            </span>
          )}
        </p>
        <p className="text-pretty">
          Cada ponto vale ~{(vpp / 1000).toLocaleString('pt-BR')} mil eleitores e mostra a proporção de votos da cidade.{progress}
        </p>
      </div>
    </div>
  );
}

function PickedCity({
  m,
  dots,
  values,
  cands,
  onClose,
}: {
  m: number | null;
  dots: DotsFile | null;
  values: Values | null;
  cands: CandidateDef[];
  onClose: () => void;
}) {
  const [city, setCity] = useState<CityView | null>(null);
  const ibge = m !== null && dots ? dots.mun[m] : null;
  useEffect(() => {
    setCity(null);
    if (!ibge) return;
    let alive = true;
    getJSON<CityView>(`/api/city/${ibge}`)
      .then((c) => alive && setCity(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ibge]);
  const touch = useMemo(coarse, []);
  // sempre ocupa o mesmo espaço: escolher ou soltar uma cidade não empurra a página
  return (
    <div className="mt-3 h-[60px]">
      {m !== null && dots && values ? (
        <div className="flex h-full items-center justify-between gap-3 rounded-xl border bg-card px-3">
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold">
              {city?.mun.name ?? '…'} <span className="font-normal text-muted-foreground">{dots.uf[m]}</span>
            </div>
            <div className="num text-[12px] text-muted-foreground">
              {fmtPct(values.pst[m], 1)}% apurado
              {!Number.isNaN(values.pa[m]) && (
                <>
                  {', '}
                  <span style={{ color: cands[0].color }}>{fmtPct(values.pa[m], 1)}</span>
                  {' × '}
                  <span style={{ color: cands[1].color }}>{fmtPct(100 - values.pa[m], 1)}</span>
                </>
              )}
            </div>
          </div>
          {city ? (
            <Link
              href={`/cidade/${city.mun.uf.toLowerCase()}/${city.mun.slug}`}
              className="press inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-lg px-2 text-[13px] font-medium"
            >
              Abrir <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : (
            <button type="button" onClick={onClose} className="min-h-11 shrink-0 px-2 text-[13px] text-muted-foreground">
              Fechar
            </button>
          )}
        </div>
      ) : (
        <p className="flex h-full items-center justify-center text-center text-[12px] text-pretty text-muted-foreground">
          {touch
            ? 'Toque numa cidade para ver o resultado. Use dois dedos ou o + para aproximar.'
            : `Clique numa cidade para ver o resultado. ${isMac ? '⌘' : 'Ctrl'} + rolagem, duplo clique ou + para aproximar.`}
        </p>
      )}
    </div>
  );
}
