// Mapa pontilhado: ~27 mil pontos (1 a cada ~6 mil eleitores), cada um preso à sua cidade.
// Um ponto acende quando o % apurado da cidade passa da "ordem" dele (sorteio fixo), e fica vermelho ou azul
// na proporção dos votos daquela cidade. Resultado: as cidades se preenchem aos poucos, em pontilhismo.
// Canvas 2D (svg com 27 mil nós travaria um celular barato); só redesenha quando chega dado novo.
import type { Board, CandidateDef } from '@apuracao/shared';
import { fmtPct } from '@apuracao/shared';
import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { getJSON, type CityView } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { useThemeColors } from './colors';

export type DotLayer = 'live' | 't1' | 'y2022';

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

let dotsP: Promise<DotsFile> | null = null;
const loadDots = () => (dotsP ??= getJSON<DotsFile>('/data/static/dots.json'));

/** hash inteiro → [0,1): sorteios fixos por ponto (ordem de acender, cor, atraso da animação) */
function hash01(i: number, salt: number): number {
  let h = (i + 1) * 374761393 + salt * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** pontos coloridos por lote de pintura (ver `paint`) */
const LOT = 256;

const reduceMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** % apurado e % de A por cidade, para a camada escolhida */
function useCityValues(dots: DotsFile | null, layer: DotLayer, board: Board | null) {
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

export default function DotMap({ layer, cands, className }: { layer: DotLayer; cands: CandidateDef[]; className?: string }) {
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
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCssW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // geometria fixa por ponto: posição, cidade e os três sorteios
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
    for (let i = 0; i < n; i++) {
      x[i] = dots.pts[i * 3] / 10;
      y[i] = dots.pts[i * 3 + 1] / 10;
      m[i] = dots.pts[i * 3 + 2];
      order[i] = hash01(i, 1) * 100;
      coin[i] = hash01(i, 2) * 100;
      delay[i] = hash01(i, 3);
      shuffle[i] = hash01(i, 4);
    }
    const perm = Uint32Array.from({ length: n }, (_, i) => i).sort((a, b) => shuffle[a] - shuffle[b]);
    // índice espacial para o toque: baldes de 12 unidades
    const B = 12;
    const bins = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const k = Math.floor(x[i] / B) * 10_000 + Math.floor(y[i] / B);
      (bins.get(k) ?? bins.set(k, []).get(k)!).push(i);
    }
    const paths = Object.fromEntries(Object.entries(dots.ufPaths).map(([uf, d]) => [uf, new Path2D(d)]));
    return { n, x, y, m, order, coin, delay, perm, bins, B, paths };
  }, [dots]);

  // quando cada ponto acendeu (para a cascata); persiste entre atualizações
  const litAt = useRef<Float64Array | null>(null);
  const raf = useRef(0);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !geo || !values || !dots || !cssW) return;
    const scale = cssW / dots.w;
    const cssH = Math.round(dots.h * scale);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    cv.style.height = `${cssH}px`;
    const ctx = cv.getContext('2d')!;

    const now0 = performance.now();
    const calm = reduceMotion();
    if (!litAt.current || litAt.current.length !== geo.n) litAt.current = new Float64Array(geo.n).fill(-1);
    const L = litAt.current;
    let until = now0;
    for (let i = 0; i < geo.n; i++) {
      const lit = geo.order[i] < values.pst[geo.m[i]];
      if (lit && L[i] < 0) {
        // acende em cascata ao longo de ~1,2s (sem animação se o sistema pede menos movimento)
        L[i] = calm ? now0 : now0 + geo.delay[i] * 1200;
        until = Math.max(until, L[i]);
      } else if (!lit) L[i] = -1;
    }

    // raio em px de tela: ~1px no celular, ~1,8px no desktop; apagado é menor
    const rPx = Math.max(0.8, Math.min(1.8, cssW / 520));
    const r = rPx / scale;
    const rOff = r * 0.55;
    const square = rPx < 1.25; // abaixo disso quadrado e círculo são iguais na tela, e quadrado é bem mais rápido
    const [ca, cb] = cands;
    const pickedM = picked;

    const draw = (now: number) => {
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      ctx.clearRect(0, 0, dots.w, dots.h);
      // contorno dos estados, discreto, só para situar
      ctx.lineWidth = 0.6 / scale;
      ctx.strokeStyle = theme.border;
      for (const p of Object.values(geo.paths)) ctx.stroke(p);

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
      const paint = (only: (mi: number) => boolean, k: number, rUnlit: number) => {
        const off = new Path2D();
        const wait = new Path2D(); // apurado, votos ainda não chegaram
        const lots: [Path2D, Path2D][] = [];
        let lot: [Path2D, Path2D] = [new Path2D(), new Path2D()];
        let c = 0;
        for (let j = 0; j < geo.n; j++) {
          const i = geo.perm[j];
          const mi = geo.m[i];
          if (!only(mi)) continue;
          const x = geo.x[i];
          const y = geo.y[i];
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
        ctx.globalAlpha = Math.min(1, 0.14 * k);
        ctx.fill(off);
        ctx.globalAlpha = Math.min(1, 0.45 * k);
        ctx.fill(wait);
        ctx.globalAlpha = Math.min(1, k);
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
      if (now < until) raf.current = requestAnimationFrame(draw);
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf.current);
  }, [geo, values, dots, cssW, theme, cands, picked]);

  // toque/clique: ponto mais próximo → cidade
  const onPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!geo || !dots) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = rect.width / dots.w;
    const px = (e.clientX - rect.left) / scale;
    const py = (e.clientY - rect.top) / scale;
    const reach = Math.max(8, 14 / scale);
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

  if (failed)
    return <p className="py-10 text-center text-sm text-muted-foreground">Não foi possível carregar o mapa de pontos.</p>;

  return (
    <div className={cn('w-full', className)}>
      <div ref={wrap} className="relative w-full">
        {!dots && <div className="aspect-[1000/1051] w-full animate-pulse rounded-xl bg-muted/60" />}
        <canvas
          ref={canvas}
          className={cn('block w-full touch-manipulation', !dots && 'hidden')}
          onPointerUp={onPointer}
          role="img"
          aria-label={
            stats
              ? `Mapa de pontos do Brasil: ${stats.started} de ${stats.total} cidades com apuração iniciada, ${stats.done} completas. Toque num ponto para ver a cidade.`
              : 'Mapa de pontos do Brasil'
          }
        />
      </div>
      <DotLegend cands={cands} vpp={dots?.vpp ?? 6000} layer={layer} stats={stats} />
      <PickedCity m={picked} dots={dots} values={values} cands={cands} onClose={() => setPicked(null)} />
    </div>
  );
}

function DotLegend({
  cands,
  vpp,
  layer,
  stats,
}: {
  cands: CandidateDef[];
  vpp: number;
  layer: DotLayer;
  stats: { started: number; done: number; total: number } | null;
}) {
  const [ca, cb] = cands;
  const sw = (bg: string, op = 1) => <span className="inline-block size-2 rounded-full" style={{ background: bg, opacity: op }} aria-hidden />;
  return (
    <div className="mt-3 space-y-1.5 text-center text-[12px] text-muted-foreground">
      <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1">
          {sw(ca.color)} {ca.short}
        </span>
        <span className="inline-flex items-center gap-1">
          {sw(cb.color)} {cb.short}
        </span>
        {layer === 'live' && (
          <span className="inline-flex items-center gap-1">
            {sw('var(--foreground)', 0.2)} ainda não apurado
          </span>
        )}
      </p>
      <p className="text-pretty">
        Cada ponto vale ~{(vpp / 1000).toLocaleString('pt-BR')} mil eleitores e mostra a proporção de votos da cidade.
        {layer === 'live' && stats ? ` ${stats.started.toLocaleString('pt-BR')} de ${stats.total.toLocaleString('pt-BR')} cidades com apuração iniciada, ${stats.done.toLocaleString('pt-BR')} completas.` : ''}
      </p>
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
  values: { pst: Float32Array; pa: Float32Array } | null;
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
        <p className="flex h-full items-center justify-center text-[12px] text-muted-foreground">Toque num ponto para ver a cidade.</p>
      )}
    </div>
  );
}
