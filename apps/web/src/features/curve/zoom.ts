// Zoom e arrasto no eixo x (% apurado) dos gráficos da noite, sem biblioteca.
// Celular: pinça aproxima/afasta em volta dos dedos; com zoom, um dedo arrasta para os lados; sem zoom, um dedo segue
// lendo o valor (scrub) e a vertical continua rolando a página (touch-action: pan-y). Computador: pinça do trackpad
// ou Ctrl/⌘ + rolagem aproximam (a rolagem pura continua rolando a página: o gráfico fica no meio da folha e não
// pode prender a rolagem), arrastar com o mouse move, rolagem horizontal move. Nos dois: duplo toque/clique aproxima
// (no máximo, volta ao todo) e os botões −/+/"ver tudo". Atualiza no máximo uma vez por quadro.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export interface XZoom {
  /** janela visível [a, b] em % apurado */
  view: [number, number];
  zoomed: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  /** px na área do gráfico → % apurado na janela atual */
  toX: (px: number) => number;
  bind: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
    onPointerLeave: (e: React.PointerEvent) => void;
    onDoubleClick: (e: React.MouseEvent) => void;
  };
}

/**
 * `full`: fim do eixo sem zoom (o eixo começa em 0). `plot`: onde fica a área do gráfico dentro do elemento (px).
 * `onScrub`: leitura por ponto (% apurado) ou null para esconder — chamado no passar do mouse e no toque sem zoom.
 */
export function useXZoom(
  el: RefObject<HTMLElement | null>,
  full: number,
  plot: { l: number; w: number },
  onScrub: (x: number | null) => void,
  minSpan = 2,
): XZoom {
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const z = useRef<[number, number] | null>(null);
  const fullRef = useRef(full);
  fullRef.current = full;
  const geo = useRef(plot);
  geo.current = plot;
  const scrub = useRef(onScrub);
  scrub.current = onScrub;

  // o eixo sem zoom cresce com a apuração: a janela com zoom fica onde está, só não passa do fim
  const clamp = useCallback(
    (a: number, b: number): [number, number] | null => {
      const F = fullRef.current;
      let span = Math.min(F, Math.max(Math.min(minSpan, F), b - a));
      if (span >= F - 1e-6) return null;
      let lo = Math.max(0, Math.min(a, F - span));
      if (!Number.isFinite(lo)) lo = 0;
      span = Math.min(span, F - lo);
      return [lo, lo + span];
    },
    [minSpan],
  );

  // no máximo um setState por quadro: arrastar/pinçar não engasga o celular
  const raf = useRef(0);
  const commit = useCallback((next: [number, number] | null) => {
    z.current = next;
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      setZoom(z.current ? [z.current[0], z.current[1]] : null);
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // o fim do eixo mudou (apurou mais): reenquadra a janela dentro do novo limite
  useEffect(() => {
    if (z.current) commit(clamp(z.current[0], z.current[1]));
  }, [full, clamp, commit]);

  const cur = (): [number, number] => z.current ?? [0, fullRef.current];
  const toX = useCallback((px: number) => {
    const [a, b] = z.current ?? [0, fullRef.current];
    const { l, w } = geo.current;
    return a + ((px - l) / Math.max(1, w)) * (b - a);
  }, []);

  /** multiplica o zoom por f mantendo parado o ponto x (em % apurado) */
  const zoomAt = useCallback(
    (f: number, x: number) => {
      const [a, b] = cur();
      const span = (b - a) / f;
      const t = (x - a) / (b - a || 1);
      commit(clamp(x - t * span, x - t * span + span));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clamp, commit],
  );
  const center = () => {
    const [a, b] = cur();
    return (a + b) / 2;
  };
  const zoomIn = useCallback(() => zoomAt(2, center()), [zoomAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoomOut = useCallback(() => zoomAt(0.5, center()), [zoomAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = useCallback(() => commit(null), [commit]);

  // rolagem: Ctrl/⌘ (e a pinça do trackpad, que chega com ctrlKey) aproxima; horizontal arrasta com zoom; o resto é da página
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      const k = e.deltaMode === 1 ? 20 : e.deltaMode === 2 ? 400 : 1;
      const r = node.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // um "dente" da roda do mouse chega como um passo grande: no máximo 2× por evento
        zoomAt(Math.min(2, Math.max(0.5, Math.exp(-e.deltaY * k * 0.01))), toX(e.clientX - r.left));
        return;
      }
      if (z.current && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        const [a, b] = z.current;
        const d = ((e.deltaX * k) / Math.max(1, geo.current.w)) * (b - a);
        commit(clamp(a + d, b + d));
      }
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [el, zoomAt, toX, clamp, commit]);

  // gestos com ponteiro
  const pts = useRef(new Map<number, number>());
  const g = useRef({
    sx: 0,
    sy: 0,
    moved: false,
    dragging: false,
    pinch: null as null | { d: number; x: number; view: [number, number] },
    lastTap: 0,
  });
  const localX = (e: React.PointerEvent | React.MouseEvent) => e.clientX - e.currentTarget.getBoundingClientRect().left;
  /** captura o ponteiro (o arrasto segue mesmo saindo do gráfico); alguns navegadores recusam e tudo bem */
  const capture = (e: React.PointerEvent) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* sem captura: o gesto segue enquanto o dedo estiver em cima */
    }
  };
  const startPinch = () => {
    const [p, q] = [...pts.current.values()];
    const mid = (p + q) / 2;
    g.current.pinch = { d: Math.max(8, Math.abs(p - q)), x: toX(mid), view: cur() };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const px = localX(e);
    pts.current.set(e.pointerId, px);
    const s = g.current;
    if (pts.current.size === 1) {
      Object.assign(s, { sx: e.clientX, sy: e.clientY, moved: false, dragging: false });
      // toque sem zoom: lê o valor no ponto (como antes do zoom)
      if (e.pointerType !== 'mouse' && !z.current) scrub.current(toX(px));
    } else if (pts.current.size === 2) {
      capture(e);
      scrub.current(null);
      startPinch();
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const px = localX(e);
    const s = g.current;
    if (!pts.current.has(e.pointerId)) {
      // mouse passando por cima: só a leitura
      if (e.pointerType === 'mouse') scrub.current(toX(px));
      return;
    }
    const prev = pts.current.get(e.pointerId)!;
    pts.current.set(e.pointerId, px);
    if (pts.current.size >= 2 && s.pinch) {
      const [p, q] = [...pts.current.values()];
      const P = s.pinch;
      const f = Math.max(8, Math.abs(p - q)) / P.d;
      const span = (P.view[1] - P.view[0]) / f;
      // o ponto que estava entre os dedos acompanha o centro dos dedos
      const t = ((p + q) / 2 - geo.current.l) / Math.max(1, geo.current.w);
      commit(clamp(P.x - t * span, P.x - t * span + span));
      return;
    }
    const dx = e.clientX - s.sx;
    const dy = e.clientY - s.sy;
    if (!s.moved && Math.hypot(dx, dy) > 6) {
      s.moved = true;
      // com zoom, arrastar na horizontal move a janela (no toque, só se o gesto for mais lateral que vertical)
      s.dragging = !!z.current && (e.pointerType === 'mouse' || Math.abs(dx) > Math.abs(dy));
      if (s.dragging) {
        capture(e);
        scrub.current(null);
      }
    }
    if (s.dragging && z.current) {
      const [a, b] = z.current;
      const d = (-(px - prev) / Math.max(1, geo.current.w)) * (b - a);
      commit(clamp(a + d, b + d));
    } else if (!z.current || e.pointerType === 'mouse') scrub.current(toX(px));
  };

  const end = (e: React.PointerEvent) => {
    if (!pts.current.delete(e.pointerId)) return false;
    const s = g.current;
    if (pts.current.size >= 2) startPinch();
    else if (pts.current.size === 1) {
      s.pinch = null;
      // segue arrastando com o dedo que ficou
      const [px] = [...pts.current.values()];
      s.dragging = !!z.current;
      s.sx = e.clientX + (px - localX(e));
      s.moved = true;
    } else s.pinch = null;
    return true;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = g.current;
    const wasTap = !s.moved && pts.current.size === 1;
    if (!end(e)) return;
    if (pts.current.size) return;
    if (e.pointerType !== 'mouse') {
      // duplo toque aproxima
      const now = performance.now();
      if (wasTap && now - s.lastTap < 320) {
        s.lastTap = 0;
        const [a, b] = cur();
        if (b - a <= minSpan * 1.05) reset();
        else zoomAt(2.5, toX(localX(e)));
        scrub.current(null);
        return;
      }
      s.lastTap = wasTap ? now : 0;
      if (wasTap) scrub.current(toX(localX(e)));
      // a leitura some sozinha depois de um tempo
      setTimeout(() => !pts.current.size && scrub.current(null), 1800);
    }
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    end(e);
    if (!pts.current.size) scrub.current(null);
  };
  const onPointerLeave = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && !pts.current.size) scrub.current(null);
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const [a, b] = cur();
    if (b - a <= minSpan * 1.05) reset();
    else zoomAt(2.5, toX(localX(e)));
  };

  return {
    view: zoom ?? [0, full],
    zoomed: !!zoom,
    zoomIn,
    zoomOut,
    reset,
    toX,
    bind: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave, onDoubleClick },
  };
}
