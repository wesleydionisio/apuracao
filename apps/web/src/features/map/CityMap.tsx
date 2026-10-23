// Mapa por cidade em dois modos, sobre os mesmos ~27 mil pontos de dots.json (1 a cada ~6 mil eleitores,
// cada um preso à sua cidade):
//  - calor: os pontos viram um campo contínuo sobre o território (heat.ts), do vermelho ao azul passando
//    pelo roxo onde a disputa está dividida, e cinza onde nada foi apurado;
//  - pontos: cada ponto acende quando o % apurado da cidade passa do sorteio dele e fica vermelho ou azul
//    na proporção dos votos da cidade (pontilhismo).
// Canvas 2D (svg com 27 mil nós travaria um celular barato), com zoom e arrasto (viewport.ts). Só redesenha
// quando chega dado novo, durante uma transição ou quando a vista muda.
import type { Board, CandidateDef } from '@apuracao/shared';
import { fmtPct } from '@apuracao/shared';
import { ChevronRight, Maximize2, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { getJSON, type CityView } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { useThemeColors } from './colors';
import { hash01, mixRgb, paintField, paintMosaic, rgbCss, smoothNoise, toRgb, type Field, type Mosaic, type Palette } from './heat';
import type { HeatReply, HeatRequest } from './heat.worker';
import { reduceMotion, useViewport } from './viewport';

export type DotLayer = 'live' | 't1' | 'y2022';
export type CityMapMode = 'heat' | 'dots';

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

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const coarse = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

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

/** mosaico de cidades calculado para uma região e um zoom (refeito quando a vista sai dela) */
interface MosaicState {
  mo: Mosaic;
  off: HTMLCanvasElement;
  img: ImageData;
  k: number;
  /** dados, paleta e cidade escolhida da última pintura */
  pv: Values | null;
  painted: string;
}

/** região (unidades do mapa) e zoom de um mosaico pronto ou pedido */
interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  k: number;
}

const smooth01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** transição do calor: o que está na tela, de onde veio e para onde vai */
interface HeatState {
  gw: number;
  gh: number;
  cell: number;
  /** na tela */
  s: Float32Array;
  p: Float32Array;
  /** início da transição */
  fs: Float32Array;
  fp: Float32Array;
  to: Field;
  /** início da transição (-1 = parado) e duração */
  t0: number;
  dur: number;
  delay: Float32Array;
  img: ImageData;
  off: HTMLCanvasElement;
  /** paleta da última pintura ('' = repintar) */
  painted: string;
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

  // geometria fixa por ponto (posição, cidade, sorteios) e por cidade (quantos pontos, centro, raio)
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
    const nm = dots.mun.length;
    const perCity = new Uint16Array(nm);
    const cx = new Float32Array(nm);
    const cy = new Float32Array(nm);
    const cr = new Float32Array(nm);
    for (let i = 0; i < n; i++) {
      x[i] = dots.pts[i * 3] / 10;
      y[i] = dots.pts[i * 3 + 1] / 10;
      m[i] = dots.pts[i * 3 + 2];
      order[i] = hash01(i, 1) * 100;
      coin[i] = hash01(i, 2) * 100;
      delay[i] = hash01(i, 3);
      shuffle[i] = hash01(i, 4);
      perCity[m[i]]++;
      cx[m[i]] += x[i];
      cy[m[i]] += y[i];
    }
    for (let c = 0; c < nm; c++) {
      cx[c] /= perCity[c] || 1;
      cy[c] /= perCity[c] || 1;
    }
    for (let i = 0; i < n; i++) cr[m[i]] += (x[i] - cx[m[i]]) ** 2 + (y[i] - cy[m[i]]) ** 2;
    for (let c = 0; c < nm; c++) cr[c] = Math.sqrt(cr[c] / (perCity[c] || 1));
    const perm = Uint32Array.from({ length: n }, (_, i) => i).sort((a, b) => shuffle[a] - shuffle[b]);
    // índice espacial para o toque: baldes de 12 unidades
    const B = 12;
    const bins = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const k = Math.floor(x[i] / B) * 10_000 + Math.floor(y[i] / B);
      (bins.get(k) ?? bins.set(k, []).get(k)!).push(i);
    }
    // contorno de todos os estados num caminho só: recorte do calor e divisas
    const outline = new Path2D(Object.values(dots.ufPaths).join(''));
    return { n, x, y, m, order, coin, delay, perm, bins, B, outline, perCity, cx, cy, cr };
  }, [dots]);

  const pal = useMemo(() => {
    const a = toRgb(cands[0].color);
    const b = toRgb(cands[1].color);
    const card = toRgb(theme.card);
    const p: Palette = { a, b, card, pending: mixRgb(card, toRgb(theme.foreground), 0.13) };
    return {
      ...p,
      ink: toRgb(theme.foreground),
      key: [cands[0].color, cands[1].color, theme.card, theme.foreground].join(),
      mid: rgbCss(mixRgb(b, a, 0.5)),
      pendingCss: rgbCss(p.pending),
    };
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

  // toque/clique: ponto mais próximo → cidade
  const onTap = (tx: number, ty: number) => {
    if (!geo || !dots || !cssW) return;
    const { k, x, y } = vp.v.current;
    const s = (cssW / dots.w) * k;
    const px = (tx - x) / s;
    const py = (ty - y) / s;
    // no calor todo o território é "clicável": alcance maior
    const reach = (mode === 'heat' ? 36 : 14) / s;
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

  // Contas pesadas (campo de calor a cada dado, mosaico a cada zoom) num worker: num celular simples cada uma
  // leva 100–200 ms, o que travaria a rolagem e o chat.
  const worker = useRef<Worker | null>(null);
  const heat = useRef<HeatState | null>(null);
  const fieldReq = useRef({ id: 0, enter: false, pending: false });
  const mosaic = useRef<MosaicState | null>(null);
  const mosaicReq = useRef<(Region & { id: number }) | null>(null);
  const mosaicSeq = useRef(0);
  const mosaicTimer = useRef(0);

  // novo campo: a tela transiciona do campo atual para ele
  const applyField = (f: Field, enter: boolean) => {
    let h = heat.current;
    if (!h || h.gw !== f.gw || h.gh !== f.gh) {
      const off = document.createElement('canvas');
      off.width = f.gw;
      off.height = f.gh;
      const N = f.gw * f.gh;
      h = heat.current = {
        gw: f.gw,
        gh: f.gh,
        cell: f.cell,
        s: new Float32Array(N),
        p: new Float32Array(N),
        fs: new Float32Array(N),
        fp: new Float32Array(N),
        to: f,
        t0: -1,
        dur: 0,
        delay: smoothNoise(f.gw, f.gh),
        img: new ImageData(f.gw, f.gh),
        off,
        painted: '',
      };
    }
    // ao entrar no modo a cor nasce do cinza
    if (enter) {
      h.s.set(f.share);
      h.p.fill(0);
    }
    h.fs.set(h.s);
    h.fp.set(h.p);
    h.to = f;
    h.t0 = performance.now();
    h.dur = reduceMotion() ? 0 : enter ? 1500 : 900;
    kick();
  };

  const onReply = useRef<(d: HeatReply) => void>(() => {});
  onReply.current = (d) => {
    if (d.type === 'field') {
      const r = fieldReq.current;
      if (d.id !== r.id) return; // chegou dado mais novo enquanto calculava
      applyField(d.f, r.enter);
      r.pending = false;
    } else if (mosaicReq.current?.id === d.id) {
      const off = document.createElement('canvas');
      off.width = d.mo.gw;
      off.height = d.mo.gh;
      mosaic.current = { mo: d.mo, off, img: new ImageData(d.mo.gw, d.mo.gh), k: mosaicReq.current.k, pv: null, painted: '' };
      mosaicReq.current = null;
      kick();
    }
  };

  useEffect(() => {
    if (!geo) return;
    const w = new Worker(new URL('./heat.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<HeatReply>) => onReply.current(e.data);
    w.postMessage({ type: 'init', pts: { n: geo.n, x: geo.x, y: geo.y, m: geo.m, perCity: geo.perCity } } satisfies HeatRequest);
    worker.current = w;
    return () => {
      w.terminate();
      worker.current = null;
      mosaicReq.current = null;
      clearTimeout(mosaicTimer.current);
    };
  }, [geo]);

  useEffect(() => {
    if (!geo || !values || !dots || mode !== 'heat' || !worker.current) return;
    const r = fieldReq.current;
    const enter = !heat.current || lastMode.current !== 'heat';
    // um pedido anterior que entrava no modo e foi atropelado continua "entrando"
    fieldReq.current = { id: r.id + 1, enter: enter || (r.pending && r.enter), pending: true };
    worker.current.postMessage({
      type: 'field',
      id: fieldReq.current.id,
      el: dots.el,
      pst: values.pst,
      pa: values.pa,
      W: dots.w,
      H: dots.h,
    } satisfies HeatRequest);
  }, [geo, values, dots, mode]);

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
    const touch = coarse();
    // raio em px de tela: ~1px no celular, ~1,8px no desktop
    const base = Math.max(0.8, Math.min(1.8, cssW / 520));

    const buildMosaic = () => {
      const w = worker.current;
      if (!w) return;
      const { k, x, y } = vp.v.current;
      const s = s0 * k;
      const vw = cssW / s;
      const vh = cssH / s;
      // a tela e mais um terço de folga para cada lado, para o arrasto curto já vir pronto
      const x0 = -x / s - vw / 3;
      const y0 = -y / s - vh / 3;
      const x1 = x0 + vw * (5 / 3);
      const y1 = y0 + vh * (5 / 3);
      // ~3 px de tela por célula (3,5 no celular)
      const gw = Math.min(480, Math.round(((x1 - x0) * s * dpr) / (touch ? 3.5 : 3)));
      mosaicReq.current = { id: ++mosaicSeq.current, x0, y0, x1, y1, k };
      w.postMessage({ type: 'mosaic', id: mosaicSeq.current, x0, y0, x1, y1, gw } satisfies HeatRequest);
    };

    const drawHeat = (now: number, s: number, k: number, vx: number, vy: number) => {
      const h = heat.current;
      if (!h) return false;
      let more = false;
      if (h.t0 >= 0) {
        const t = h.dur ? (now - h.t0) / h.dur : 1;
        for (let c = 0; c < h.s.length; c++) {
          // cada região começa num momento (ruído suave): a cor se espalha em manchas, não pisca inteira
          const lt = Math.min(1, Math.max(0, (t - h.delay[c] * 0.45) / 0.55));
          const e = 1 - (1 - lt) ** 3;
          h.s[c] = h.fs[c] + (h.to.share[c] - h.fs[c]) * e;
          h.p[c] = h.fp[c] + (h.to.prog[c] - h.fp[c]) * e;
        }
        if (t >= 1) h.t0 = -1;
        else more = true;
        h.painted = '';
      }
      if (h.painted !== pal.key) {
        paintField(h.img, h.s, h.p, h.to.dens, pal);
        h.off.getContext('2d')!.putImageData(h.img, 0, 0);
        h.painted = pal.key;
      }
      ctx.save();
      ctx.clip(geo.outline);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(h.off, 0, 0, h.gw * h.cell, h.gh * h.cell);
      // com zoom o calor se resolve em cidades (aparece entre 1,8× e 3,4×)
      const fade = smooth01((k - 1.8) / 1.6);
      if (fade > 0) {
        const mz = mosaic.current;
        const vx0 = -vx / s;
        const vy0 = -vy / s;
        const vx1 = vx0 + cssW / s;
        const vy1 = vy0 + cssH / s;
        const covers = (r: Region) => r.k > k / 1.6 && r.k < k * 1.6 && r.x0 <= vx0 && r.y0 <= vy0 && r.x1 >= vx1 && r.y1 >= vy1;
        const ready =
          mz && covers({ k: mz.k, x0: mz.mo.x0, y0: mz.mo.y0, x1: mz.mo.x0 + mz.mo.gw * mz.mo.cell, y1: mz.mo.y0 + mz.mo.gh * mz.mo.cell });
        // pede outro quando a vista para de mexer e nem o pronto nem o já pedido cobrem a tela
        clearTimeout(mosaicTimer.current);
        if (!ready && !(mosaicReq.current && covers(mosaicReq.current))) mosaicTimer.current = window.setTimeout(buildMosaic, 140);
        if (mz) {
          const key = `${pal.key}|${pickedM}`;
          if (mz.pv !== values || mz.painted !== key) {
            paintMosaic(mz.img, mz.mo, values.pst, values.pa, pal, pal.ink, pickedM, Math.min(0.5, 0.12 + 0.035 * mz.k));
            mz.off.getContext('2d')!.putImageData(mz.img, 0, 0);
            mz.pv = values;
            mz.painted = key;
          }
          ctx.globalAlpha = fade;
          ctx.drawImage(mz.off, mz.mo.x0, mz.mo.y0, mz.mo.gw * mz.mo.cell, mz.mo.gh * mz.mo.cell);
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
      // divisas como recortes finos na cor do cartão
      ctx.lineWidth = 1 / s;
      ctx.strokeStyle = theme.card;
      ctx.globalAlpha = 0.6;
      ctx.stroke(geo.outline);
      ctx.globalAlpha = 1;
      if (pickedM !== null && k < 2.6) {
        // anel em volta da cidade escolhida (com zoom, o mosaico já contorna a cidade), com halo para aparecer sobre qualquer cor
        ctx.beginPath();
        ctx.arc(geo.cx[pickedM], geo.cy[pickedM], Math.max(geo.cr[pickedM] * 1.8, 7 / s), 0, Math.PI * 2);
        ctx.lineWidth = 4 / s;
        ctx.strokeStyle = theme.card;
        ctx.stroke();
        ctx.lineWidth = 1.75 / s;
        ctx.strokeStyle = theme.foreground;
        ctx.stroke();
      }
      return more;
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
      return mode === 'heat' ? drawHeat(now, s, k, x, y) : drawDots(now, s, k, x, y);
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

  const what = mode === 'heat' ? 'Mapa de calor do voto no Brasil' : 'Mapa de pontos do Brasil';
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
      <Legend mode={mode} cands={cands} mid={pal.mid} pending={pal.pendingCss} vpp={dots?.vpp ?? 6000} layer={layer} stats={stats} />
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

function Legend({
  mode,
  cands,
  mid,
  pending,
  vpp,
  layer,
  stats,
}: {
  mode: CityMapMode;
  cands: CandidateDef[];
  mid: string;
  pending: string;
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
      <div className={cn('space-y-1.5', mode !== 'heat' && 'invisible')} aria-hidden={mode !== 'heat'}>
        <div className="mx-auto flex max-w-[360px] items-center gap-2">
          <span>{ca.short}</span>
          <span className="h-2 flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${ca.color}, ${mid}, ${cb.color})` }} aria-hidden />
          <span>{cb.short}</span>
          {live && (
            <span className="ml-1 inline-flex items-center gap-1">
              {sw(pending)} não apurado
            </span>
          )}
        </div>
        <p className="text-pretty">
          Roxo onde a disputa está dividida; a cor ganha força conforme as urnas da região são apuradas.{progress}
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
