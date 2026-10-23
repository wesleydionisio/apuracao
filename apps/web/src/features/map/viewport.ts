// Zoom e arrasto do mapa em canvas, sem biblioteca. Celular: pinça (e arrasto com dois dedos); com zoom, um
// dedo arrasta. Sem zoom, um dedo continua rolando a página (touch-action: pan-y), para o mapa não prender
// a rolagem. Computador: Ctrl/⌘ + rolagem ou pinça do trackpad, arrastar com o mouse. Nos dois: duplo
// toque/clique aproxima, botões +/−, teclado (+, −, 0, setas).
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** tela (px CSS) = posição no mapa sem zoom × k + (x, y) */
export interface View {
  k: number;
  x: number;
  y: number;
}

export const MAX_ZOOM = 16;

export const reduceMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useViewport(
  el: RefObject<HTMLElement | null>,
  w: number,
  h: number,
  redraw: () => void,
  onTap: (x: number, y: number) => void,
) {
  const v = useRef<View>({ k: 1, x: 0, y: 0 });
  const [zoomed, setZoomed] = useState(false);
  const [hint, setHint] = useState(false);
  const size = useRef({ w, h });
  const cb = useRef({ redraw, onTap });
  cb.current = { redraw, onTap };
  const anim = useRef(0);

  /** zoom entre 1 e MAX_ZOOM, e o mapa sempre cobrindo a moldura (sem arrastar para o vazio) */
  const clamp = useCallback((n: View): View => {
    const { w, h } = size.current;
    const k = Math.min(MAX_ZOOM, Math.max(1, n.k));
    return { k, x: Math.min(0, Math.max(w - w * k, n.x)), y: Math.min(0, Math.max(h - h * k, n.y)) };
  }, []);

  const set = useCallback(
    (n: View) => {
      v.current = clamp(n);
      setZoomed(v.current.k > 1.001);
      cb.current.redraw();
    },
    [clamp],
  );

  const animateTo = useCallback(
    (target: View) => {
      cancelAnimationFrame(anim.current);
      const to = clamp(target);
      if (reduceMotion()) return set(to);
      const from = { ...v.current };
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / 260);
        const e = 1 - (1 - t) ** 3;
        // zoom em escala log: a velocidade parece constante
        set({ k: from.k * (to.k / from.k) ** e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
        if (t < 1) anim.current = requestAnimationFrame(step);
      };
      anim.current = requestAnimationFrame(step);
    },
    [clamp, set],
  );

  /** multiplica o zoom por f mantendo parado o ponto (cx, cy) da tela */
  const zoomAt = useCallback(
    (f: number, cx: number, cy: number, animate = false) => {
      const c = v.current;
      const k = Math.min(MAX_ZOOM, Math.max(1, c.k * f));
      const to = { k, x: cx - ((cx - c.x) / c.k) * k, y: cy - ((cy - c.y) / c.k) * k };
      if (animate) animateTo(to);
      else set(to);
    },
    [animateTo, set],
  );

  const zoomBy = useCallback((f: number) => zoomAt(f, size.current.w / 2, size.current.h / 2, true), [zoomAt]);
  const reset = useCallback(() => animateTo({ k: 1, x: 0, y: 0 }), [animateTo]);

  // mudou a largura (girou o celular, redimensionou a janela): mantém o mesmo enquadramento
  useEffect(() => {
    const old = size.current;
    size.current = { w, h };
    if (old.w && w && old.w !== w) {
      const f = w / old.w;
      set({ k: v.current.k, x: v.current.x * f, y: v.current.y * f });
    }
  }, [w, h, set]);

  // Ctrl/⌘ + rolagem (e a pinça do trackpad, que chega como rolagem com ctrlKey); rolagem pura rola a página
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let hide = 0;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        setHint(true);
        clearTimeout(hide);
        hide = window.setTimeout(() => setHint(false), 1400);
        return;
      }
      e.preventDefault();
      setHint(false);
      const r = node.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
      zoomAt(Math.exp(-dy * 0.004), e.clientX - r.left, e.clientY - r.top);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      node.removeEventListener('wheel', onWheel);
      clearTimeout(hide);
    };
  }, [el, zoomAt]);

  // gestos
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef({
    moved: false,
    t: 0,
    sx: 0,
    sy: 0,
    pinch: null as null | { d: number; cx: number; cy: number; v: View },
    lastTap: { t: 0, x: 0, y: 0 },
  });
  const local = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const startPinch = () => {
    const [a, b] = [...pts.current.values()];
    g.current.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, v: { ...v.current } };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    pts.current.set(e.pointerId, p);
    cancelAnimationFrame(anim.current);
    const s = g.current;
    if (pts.current.size === 1) Object.assign(s, { moved: false, t: performance.now(), sx: p.x, sy: p.y });
    if (pts.current.size === 2) {
      s.moved = true;
      startPinch();
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pts.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pts.current.set(e.pointerId, p);
    const s = g.current;
    if (Math.hypot(p.x - s.sx, p.y - s.sy) > 6) s.moved = true;
    if (pts.current.size >= 2 && s.pinch) {
      const [a, b] = [...pts.current.values()];
      const P = s.pinch;
      const k = P.v.k * (Math.hypot(a.x - b.x, a.y - b.y) / P.d);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      // o ponto do mapa que estava sob o centro dos dedos acompanha o centro atual
      set({ k, x: cx - ((P.cx - P.v.x) / P.v.k) * k, y: cy - ((P.cy - P.v.y) / P.v.k) * k });
    } else if (s.moved && v.current.k > 1.001) {
      set({ ...v.current, x: v.current.x + p.x - prev.x, y: v.current.y + p.y - prev.y });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!pts.current.delete(e.pointerId)) return;
    const s = g.current;
    if (pts.current.size >= 2) return startPinch();
    if (pts.current.size === 1) {
      s.pinch = null; // segue arrastando com o dedo que ficou
      return;
    }
    s.pinch = null;
    if (s.moved || performance.now() - s.t > 500) return;
    const p = local(e);
    const now = performance.now();
    if (now - s.lastTap.t < 320 && Math.hypot(p.x - s.lastTap.x, p.y - s.lastTap.y) < 30) {
      s.lastTap.t = 0;
      if (v.current.k >= MAX_ZOOM * 0.99) reset();
      else zoomAt(2.5, p.x, p.y, true);
      return;
    }
    s.lastTap = { t: now, x: p.x, y: p.y };
    cb.current.onTap(p.x, p.y);
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId);
    g.current.pinch = null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const c = v.current;
    const step = 80;
    if (e.key === '+' || e.key === '=') zoomBy(2);
    else if (e.key === '-' || e.key === '_') zoomBy(0.5);
    else if (e.key === '0') reset();
    else if (c.k > 1.001 && e.key === 'ArrowLeft') animateTo({ ...c, x: c.x + step });
    else if (c.k > 1.001 && e.key === 'ArrowRight') animateTo({ ...c, x: c.x - step });
    else if (c.k > 1.001 && e.key === 'ArrowUp') animateTo({ ...c, y: c.y + step });
    else if (c.k > 1.001 && e.key === 'ArrowDown') animateTo({ ...c, y: c.y - step });
    else return;
    e.preventDefault();
  };

  return {
    v,
    zoomed,
    hint,
    zoomBy,
    reset,
    bind: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown },
  };
}
