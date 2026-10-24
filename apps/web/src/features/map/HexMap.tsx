// O mapa do site: o Brasil (ou uma UF) em hexágonos do mesmo tamanho, na cor de quem lidera ali, em três tons
// pela vantagem. Por cidade (padrão), o hexágono cresce de um ponto apagado até o tamanho cheio conforme a
// região é apurada; por estado (`ufValues`), cada hexágono leva a cor do seu estado. Com zoom, os hexágonos
// ficam menores (quatro tamanhos, de ~55 a ~7 km), e o desenho mais fino já mostra o recorte das cidades.
// Canvas 2D com zoom e arrasto (viewport.ts); só redesenha quando chega dado, numa transição ou quando a vista muda.
import type { CandidateDef } from '@apuracao/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { dotGeo, RADII, useCityValues, useDots, useHexLevels, type DotLayer, type Values } from './citydata';
import { useThemeColors } from './colors';
import type { UfValue } from './data';
import { bandOfMargin, hash01, hexPath, hexUnder, hexValues, rgbCss, shades, toRgb, type HexLevel } from './hex';
import { reduceMotion, useViewport } from './viewport';
import { ZoomControls } from './ZoomControls';

export interface HexHit {
  city: number;
  ibge: string;
  uf: string;
  /** posição relativa ao mapa, em px CSS */
  x: number;
  y: number;
  /** % de A e % apurado da cidade na camada do mapa (para a ficha de quem usa o mapa) */
  pa: number | null;
  pst: number | null;
}

const ease = (t: number) => 1 - (1 - t) ** 3;
/** hexágono na tela abaixo disso vira mancha: usa-se o nível mais grosso seguinte */
const MIN_HEX_PX = 6;

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

/** um nível em transição: de onde vem e para onde vai cada hexágono (% de A e fração apurada) */
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

function shownAt(st: HexState, lv: LevelView, h: number, now: number): [number, number] {
  const t = st.dur ? (now - st.t0) / st.dur : 1;
  const e = ease(Math.min(1, Math.max(0, (t - lv.delay[h] * 0.45) / 0.55)));
  return [lv.fs[h] + (lv.ts[h] - lv.fs[h]) * e, lv.fq[h] + (lv.tq[h] - lv.fq[h]) * e];
}

export default function HexMap({
  cands,
  layer = 'live',
  cityValues,
  ufValues,
  scope = 'BR',
  highlight,
  dimOthers = false,
  selectedUf,
  labels = false,
  onPick,
  onHover,
  zoomable = true,
  maxHeight,
  className,
  label,
}: {
  cands: CandidateDef[];
  /** cor por cidade: ao vivo, 1º turno ou 2022 */
  layer?: DotLayer;
  /** valores por cidade já carregados por quem usa o mapa (evita buscar de novo) */
  cityValues?: Values | null;
  /** cor por estado (vence `layer`): o mapa de quem lidera em cada UF, ou o deslocamento */
  ufValues?: Record<string, UfValue | undefined>;
  /** 'BR' ou uma UF (só os hexágonos dela, enquadrados) */
  scope?: string;
  /** código IBGE da cidade contornada */
  highlight?: string | null;
  /** com `highlight`, o resto recua */
  dimOthers?: boolean;
  selectedUf?: string | null;
  /** siglas dos estados maiores */
  labels?: boolean;
  onPick?: (hit: HexHit | null) => void;
  /** mouse por cima (só desktop) */
  onHover?: (hit: HexHit | null) => void;
  zoomable?: boolean;
  maxHeight?: number;
  className?: string;
  label?: string;
}) {
  const board = useBoard((s) => s.board);
  const { dots, failed } = useDots();
  const levels = useHexLevels(dots);
  const own = useCityValues(dots, layer, board, !ufValues && cityValues === undefined);
  const cityVals = cityValues ?? own;
  const geo = useMemo(() => (dots ? dotGeo(dots) : null), [dots]);
  const theme = useThemeColors();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cssW, setCssW] = useState(0);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCssW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // enquadramento: o Brasil inteiro ou a caixa da UF, na largura disponível (altura limitada por `maxHeight`)
  const frame = useMemo(() => {
    if (!dots || !geo || !cssW) return null;
    let [x0, y0, x1, y1] = scope === 'BR' ? [0, 0, dots.w, dots.h] : (geo.ufBox[scope] ?? [0, 0, dots.w, dots.h]);
    const pad = scope === 'BR' ? 0 : Math.max(x1 - x0, y1 - y0) * 0.03;
    x0 -= pad;
    y0 -= pad;
    x1 += pad;
    y1 += pad;
    let s0 = cssW / (x1 - x0);
    let h = (y1 - y0) * s0;
    if (maxHeight && h > maxHeight) {
      s0 = maxHeight / (y1 - y0);
      h = maxHeight;
    }
    return { ox: x0, oy: y0, s0, offX: (cssW - (x1 - x0) * s0) / 2, h: Math.round(h) };
  }, [dots, geo, cssW, scope, maxHeight]);
  const cssH = frame?.h ?? 0;

  // hexágonos de cada nível dentro do escopo (no Brasil, todos os que têm dado)
  const inScope = useMemo(() => {
    if (!levels || !dots) return null;
    return levels.map((L) => {
      const out: number[] = [];
      for (let h = 0; h < L.n; h++) {
        const c = L.city[h];
        if (c >= 0 && (scope === 'BR' || dots.uf[c] === scope)) out.push(h);
      }
      return Int32Array.from(out);
    });
  }, [levels, dots, scope]);

  // posição das siglas: centro dos hexágonos de cada UF no nível mais grosso (só as UFs grandes)
  const ufLabels = useMemo(() => {
    if (!labels || !levels || !dots) return [];
    const acc = new Map<string, [number, number, number]>();
    const L = levels[0];
    for (let h = 0; h < L.n; h++) {
      const c = L.city[h];
      if (c < 0) continue;
      const a = acc.get(dots.uf[c]) ?? [0, 0, 0];
      a[0] += L.cx[h];
      a[1] += L.cy[h];
      a[2]++;
      acc.set(dots.uf[c], a);
    }
    return [...acc]
      .filter(([, a]) => a[2] >= 40)
      .map(([uf, a]) => ({ uf, x: a[0] / a[2], y: a[1] / a[2] }));
  }, [labels, levels, dots]);

  const pal = useMemo(() => {
    const card = toRgb(theme.card);
    const dark = 0.2126 * card[0] + 0.7152 * card[1] + 0.0722 * card[2] < 110;
    return { a: shades(toRgb(cands[0].color)).map(rgbCss), b: shades(toRgb(cands[1].color)).map(rgbCss), dark };
  }, [cands, theme]);

  // um laço de desenho só: cada mudança (dado, vista, tema) pede um quadro; transições pedem os seguintes
  const draw = useRef<(now: number) => boolean>(() => false);
  const rafId = useRef(0);
  const kick = useCallback(() => {
    if (rafId.current) return;
    const loop = (now: number) => {
      rafId.current = 0;
      if (draw.current(now)) rafId.current = requestAnimationFrame(loop);
    };
    rafId.current = requestAnimationFrame(loop);
  }, []);
  useEffect(() => () => cancelAnimationFrame(rafId.current), []);

  /** nível para o zoom atual: o mais fino cujo hexágono ainda tem ≥ 6 px na tela */
  const levelFor = (k: number) => {
    if (!frame) return 0;
    let li = 0;
    for (let i = 0; i < RADII.length; i++) if (Math.sqrt(3) * RADII[i] * frame.s0 * k >= MIN_HEX_PX) li = i;
    return li;
  };

  const hitAt = (sx: number, sy: number): HexHit | null => {
    if (!levels || !frame || !dots) return null;
    const { k, x, y } = vp.v.current;
    const T = frame.s0 * k;
    const tx = (frame.offX - frame.ox * frame.s0) * k + x;
    const ty = -frame.oy * frame.s0 * k + y;
    const L = levels[levelFor(k)];
    const h = hexUnder(L, (sx - tx) / T, (sy - ty) / T);
    const c = h >= 0 ? L.city[h] : -1;
    if (c < 0 || (scope !== 'BR' && dots.uf[c] !== scope)) return null;
    const pa = cityVals && !Number.isNaN(cityVals.pa[c]) ? cityVals.pa[c] : null;
    const pst = cityVals && !Number.isNaN(cityVals.pst[c]) ? cityVals.pst[c] : null;
    return { city: c, ibge: dots.mun[c], uf: dots.uf[c], x: sx, y: sy, pa, pst };
  };

  const vp = useViewport(canvas, cssW, cssH, kick, (x, y) => onPick?.(hitAt(x, y)), zoomable);

  // a cada dado, cada hexágono transiciona do que está na tela para o novo valor
  const hex = useRef<HexState | null>(null);
  useEffect(() => {
    if (!levels || !dots || !geo || (!ufValues && !cityVals)) return;
    const now = performance.now();
    const st = hex.current;
    // primeira vez (ou grade nova): os hexágonos nascem apagados e crescem
    const enter = !st || st.levels[0].L !== levels[0];
    const next = levels.map((L, li) => {
      const n = L.n;
      let share: Float32Array;
      let prog: Float32Array;
      if (ufValues) {
        share = new Float32Array(n);
        prog = new Float32Array(n);
        for (let h = 0; h < n; h++) {
          const v = L.city[h] >= 0 ? ufValues[dots.uf[L.city[h]]] : undefined;
          share[h] = v?.pa ?? NaN;
          prog[h] = v?.pa != null ? 1 : 0;
        }
      } else ({ share, prog } = hexValues(L, geo, dots.el, cityVals!.pst, cityVals!.pa));
      const prev = enter ? null : st!.levels[li];
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
  }, [levels, dots, geo, ufValues, cityVals, kick]);

  // desenho de um quadro, com a vista atual
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !geo || !dots || !frame || !inScope) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(cssW * dpr);
    const H = Math.round(cssH * dpr);
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    const ctx = cv.getContext('2d')!;
    const hi = highlight ? (geo.byIbge.get(highlight) ?? null) : null;
    // brilho do tema escuro: a imagem reduzida 6× e ampliada de volta vira um halo macio atrás dos hexágonos
    const glow = document.createElement('canvas');
    glow.width = Math.ceil(W / 6);
    glow.height = Math.ceil(H / 6);
    const gctx = glow.getContext('2d')!;
    const scopeOutline = scope === 'BR' ? geo.outline : geo.ufOutline[scope];

    draw.current = (now: number) => {
      const st = hex.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!st) return false;
      const { k, x: vx, y: vy } = vp.v.current;
      const T = frame.s0 * k;
      const tx = (frame.offX - frame.ox * frame.s0) * k + vx;
      const ty = -frame.oy * frame.s0 * k + vy;
      ctx.setTransform(dpr * T, 0, 0, dpr * T, dpr * tx, dpr * ty);
      const li = levelFor(k);
      const lv = st.levels[li];
      const { L } = lv;
      const R = L.R;
      // só o que está na tela
      const x0 = -tx / T - R;
      const y0 = -ty / T - R;
      const x1 = (cssW - tx) / T + R;
      const y1 = (cssH - ty) / T + R;
      // 0–2 tons de A, 3–5 tons de B; um conjunto para o mapa e outro para a cidade em destaque
      const fills = Array.from({ length: 6 }, () => new Path2D());
      const fillsHi = Array.from({ length: 6 }, () => new Path2D());
      const off = new Path2D();
      const offHi = new Path2D();
      const ring = new Path2D();
      // os pontos apagados (ainda sem votos) ficam sempre na grade mais grossa e com o mesmo tamanho na tela:
      // com zoom eles só se afastam, não se multiplicam nem crescem
      const lv0 = st.levels[0];
      const dotR = (0.2 * lv0.L.R * frame.s0) / T;
      const idx0 = inScope[0];
      for (let j = 0; j < idx0.length; j++) {
        const h = idx0[j];
        const x = lv0.L.cx[h];
        const y = lv0.L.cy[h];
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        if (shownAt(st, lv0, h, now)[1] >= 0.015) continue;
        hexPath(hi !== null && lv0.L.city[h] === hi ? offHi : off, x, y, dotR);
      }
      const idx = inScope[li];
      for (let j = 0; j < idx.length; j++) {
        const h = idx[j];
        const x = L.cx[h];
        const y = L.cy[h];
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        const mine = hi !== null && L.city[h] === hi;
        const [sh, q] = shownAt(st, lv, h, now);
        if (mine) hexPath(ring, x, y, R * 0.97);
        // ainda sem votos: fica o ponto apagado da grade grossa, desenhado acima
        if (q < 0.015) continue;
        // cresce de ~1/3 até 92% do raio conforme a região é apurada (o resto é o vão entre hexágonos)
        const r = R * (0.32 + 0.6 * Math.sqrt(q));
        const i = (sh >= 50 ? 0 : 3) + bandOfMargin(Math.abs(2 * sh - 100));
        hexPath((mine ? fillsHi : fills)[i], x, y, r);
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
      paint(fills, off, hi !== null && dimOthers ? 0.5 : 1);
      paint(fillsHi, offHi, 1);
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
      // divisas discretas; a UF escolhida e a cidade em destaque contornadas na cor do texto
      ctx.lineWidth = 0.8 / T;
      ctx.strokeStyle = theme.foreground;
      ctx.globalAlpha = 0.22;
      if (scopeOutline) ctx.stroke(scopeOutline);
      ctx.globalAlpha = 1;
      if (selectedUf && geo.ufOutline[selectedUf]) {
        ctx.lineWidth = 2 / T;
        ctx.stroke(geo.ufOutline[selectedUf]);
      }
      if (hi !== null) {
        ctx.lineWidth = 1.5 / T;
        ctx.stroke(ring);
      }
      if (ufLabels.length) {
        ctx.font = `600 ${12 / T}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 4;
        for (const l of ufLabels) ctx.fillText(l.uf, l.x, l.y);
        ctx.shadowBlur = 0;
      }
      return st.dur > 0 && now - st.t0 < st.dur;
    };
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, dots, frame, inScope, cssW, cssH, theme, pal, highlight, dimOthers, selectedUf, ufLabels, kick, vp.v]);

  // mouse por cima
  const hovered = useRef<number | null>(null);
  const hover = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!onHover || e.pointerType !== 'mouse' || e.buttons) return;
    const r = e.currentTarget.getBoundingClientRect();
    const hit = hitAt(e.clientX - r.left, e.clientY - r.top);
    // a ficha acompanha o mouse; sair do mapa (ou para o mar) avisa uma vez só
    if (!hit && hovered.current === null) return;
    hovered.current = hit?.city ?? null;
    onHover(hit);
  };

  if (failed) return <p className={cn('py-10 text-center text-sm text-muted-foreground', className)}>Não foi possível carregar o mapa.</p>;

  return (
    <div ref={wrap} className={cn('relative w-full overflow-hidden rounded-xl', className)}>
      {!frame && <div className="aspect-[1000/1051] w-full animate-pulse rounded-xl bg-muted/60" />}
      <canvas
        ref={canvas}
        data-vaul-no-drag
        tabIndex={zoomable || onPick ? 0 : -1}
        {...(zoomable ? vp.bind : {})}
        onPointerMove={(e) => {
          if (zoomable) vp.bind.onPointerMove(e);
          hover(e);
        }}
        onPointerLeave={() => {
          hovered.current = null;
          onHover?.(null);
        }}
        onClick={
          !zoomable && onPick
            ? (e) => {
                const r = e.currentTarget.getBoundingClientRect();
                onPick(hitAt(e.clientX - r.left, e.clientY - r.top));
              }
            : undefined
        }
        className={cn(
          'block w-full select-none focus-visible:outline-offset-[-2px]',
          zoomable ? 'cursor-grab active:cursor-grabbing' : onPick && 'cursor-pointer',
          !frame && 'hidden',
        )}
        // sem zoom, um dedo rola a página na vertical (e arrasta o mapa para os lados); com zoom, arrasta o mapa
        style={{ height: cssH || undefined, touchAction: zoomable ? (vp.zoomed ? 'none' : 'pan-y') : undefined }}
        role="img"
        aria-label={label ?? 'Mapa do Brasil em hexágonos, na cor de quem lidera em cada região'}
      />
      {zoomable && frame && <ZoomControls zoomed={vp.zoomed} away={vp.away} onIn={() => vp.zoomBy(2)} onOut={() => vp.zoomBy(0.5)} onReset={vp.reset} />}
    </div>
  );
}
