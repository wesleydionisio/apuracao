// Mapa por cidade da aba Mapa, em dois modos sobre os mesmos ~27 mil pontos de dots.json (1 a cada ~6 mil
// eleitores, cada um preso à sua cidade):
//  - grade: o mapa de hexágonos do site (HexMap);
//  - pontos: cada ponto acende quando o % apurado da cidade passa do sorteio dele e fica vermelho ou azul
//    na proporção dos votos da cidade (pontilhismo), com zoom e arrasto.
// Em volta, a legenda do modo e o cartão da cidade tocada.
import type { CandidateDef } from '@apuracao/shared';
import { fmtPct } from '@apuracao/shared';
import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { getJSON, type CityView } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { dotDraws, dotGeo, useCityValues, useDots, type DotLayer, type DotsFile, type Values } from './citydata';
import { useThemeColors } from './colors';
import HexMap from './HexMap';
import { HexGlyph, useHexShades } from './Legend';
import { reduceMotion, useViewport } from './viewport';
import { ZoomControls } from './ZoomControls';

export type { DotLayer };
export type CityMapMode = 'hex' | 'dots';

/** pontos coloridos por lote de pintura (ver `paint` no modo pontos) */
const LOT = 256;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const coarse = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

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
  const { dots, failed } = useDots();
  const values = useCityValues(dots, layer, board);
  const [picked, setPicked] = useState<number | null>(null);
  const shadesCss = useHexShades(cands);

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

  return (
    <div className={cn('w-full', className)}>
      {mode === 'hex' ? (
        <HexMap
          cands={cands}
          layer={layer}
          cityValues={values}
          highlight={picked !== null && dots ? dots.mun[picked] : null}
          onPick={(hit) => setPicked(hit?.city ?? null)}
          label={
            stats
              ? `Mapa do Brasil em hexágonos: ${stats.started} de ${stats.total} cidades com apuração iniciada, ${stats.done} completas. Toque para ver uma cidade; + e − aproximam e afastam.`
              : undefined
          }
        />
      ) : (
        <DotsCanvas dots={dots} values={values} cands={cands} picked={picked} onPick={setPicked} stats={stats} />
      )}
      <Legend mode={mode} cands={cands} shades={shadesCss} vpp={dots?.vpp ?? 6000} layer={layer} stats={stats} />
      <PickedCity m={picked} dots={dots} values={values} cands={cands} onClose={() => setPicked(null)} />
    </div>
  );
}

/** modo pontos: canvas próprio, com zoom e arrasto */
function DotsCanvas({
  dots,
  values,
  cands,
  picked,
  onPick,
  stats,
}: {
  dots: DotsFile | null;
  values: Values | null;
  cands: CandidateDef[];
  picked: number | null;
  onPick: (m: number | null) => void;
  stats: { started: number; done: number; total: number } | null;
}) {
  const theme = useThemeColors();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cssW, setCssW] = useState(0);
  const cssH = dots && cssW ? (cssW * dots.h) / dots.w : 0;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCssW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // geometria e sorteios fixos por ponto, mais o índice espacial do toque (baldes de 12 unidades)
  const geo = useMemo(() => {
    if (!dots) return null;
    const g = dotGeo(dots);
    const B = 12;
    const bins = new Map<number, number[]>();
    for (let i = 0; i < g.n; i++) {
      const k = Math.floor(g.x[i] / B) * 10_000 + Math.floor(g.y[i] / B);
      (bins.get(k) ?? bins.set(k, []).get(k)!).push(i);
    }
    return { ...g, ...dotDraws(g.n), bins, B };
  }, [dots]);

  // um laço de desenho só: cada mudança (dado, vista, tema) pede um quadro; a cascata pede os seguintes
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
    onPick(best >= 0 ? geo.m[best] : null);
  };
  const vp = useViewport(canvas, cssW, cssH, kick, onTap);

  // quando cada ponto acendeu (para a cascata); persiste entre atualizações
  const litAt = useRef<Float64Array | null>(null);
  const until = useRef(0);
  useEffect(() => {
    if (!geo || !values) return;
    const now0 = performance.now();
    const calm = reduceMotion();
    if (!litAt.current || litAt.current.length !== geo.n) litAt.current = new Float64Array(geo.n).fill(-1);
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
  }, [geo, values, kick]);

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
    // raio em px de tela: ~1px no celular, ~1,8px no desktop
    const base = Math.max(0.8, Math.min(1.8, cssW / 520));

    frame.current = (now: number) => {
      const L = litAt.current;
      const { k, x: vx, y: vy } = vp.v.current;
      const s = s0 * k;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!L) return false;
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * vx, dpr * vy);
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
    kick();
  }, [geo, values, dots, cssW, cssH, theme, cands, picked, kick, vp.v]);

  return (
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
            ? `Mapa de pontos do Brasil: ${stats.started} de ${stats.total} cidades com apuração iniciada, ${stats.done} completas. Toque para ver uma cidade; + e − aproximam e afastam.`
            : 'Mapa de pontos do Brasil'
        }
      />
      {dots && <ZoomControls zoomed={vp.zoomed} onIn={() => vp.zoomBy(2)} onOut={() => vp.zoomBy(0.5)} onReset={vp.reset} />}
    </div>
  );
}

/** os três tons de cada candidato, do mais vivo para fora */
export function HexLegend({ cands, shades, className }: { cands: CandidateDef[]; shades: { a: string[]; b: string[] }; className?: string }) {
  const [ca, cb] = cands;
  return (
    <div className={cn('flex items-center justify-center gap-3 text-[12px] text-muted-foreground', className)}>
      <span className="inline-flex items-center gap-1.5">
        <span className="flex gap-0.5">
          {shades.a.map((c) => (
            <HexGlyph key={c} color={c} />
          ))}
        </span>
        {ca.short}
      </span>
      <span className="inline-flex items-center gap-1.5">
        {cb.short}
        <span className="flex gap-0.5">
          {[...shades.b].reverse().map((c) => (
            <HexGlyph key={c} color={c} />
          ))}
        </span>
      </span>
    </div>
  );
}

function Legend({
  mode,
  cands,
  shades,
  vpp,
  layer,
  stats,
}: {
  mode: CityMapMode;
  cands: CandidateDef[];
  shades: { a: string[]; b: string[] };
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
        <HexLegend cands={cands} shades={shades} />
        <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-pretty">
          <span>Tom mais vivo, vantagem maior.</span>
          {live && (
            <span className="inline-flex items-center gap-1">
              O hexágono cresce
              <span className="inline-flex items-end gap-0.5">
                <HexGlyph color="currentColor" size={5} opacity={0.5} />
                <HexGlyph color="currentColor" size={8} opacity={0.7} />
                <HexGlyph color="currentColor" size={11} />
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
            : `Clique numa cidade para ver o resultado. Role ${isMac ? 'ou use a pinça do trackpad ' : ''}sobre o mapa para aproximar.`}
        </p>
      )}
    </div>
  );
}
