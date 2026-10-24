// Só em dev (cookie `shiftlog=1`): mede layout shift desde o primeiro quadro comparando a posição dos mesmos
// elementos a cada 100 ms. Serve onde o navegador não entrega `layout-shift` (aba oculta, webviews de teste).
// A pontuação imita o CLS: fração visível da tela que se mexeu × distância / maior lado da tela.
// Resultado em `window.__shifts` ({ score, log }); `window.__shiftsReset()` zera.

type Rect = { x: number; y: number; w: number; h: number };

let prev = new Map<Element, Rect>();
const state = { score: 0, log: [] as { t: number; s: number; el: string; dy: number }[] };

function snap() {
  const m = new Map<Element, Rect>();
  for (const el of document.querySelectorAll('#root *')) {
    if (el.children.length > 3) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    m.set(el, { x: r.x, y: r.y, w: r.width, h: r.height });
  }
  return m;
}

function tick() {
  const next = snap();
  const vw = innerWidth;
  const vh = innerHeight;
  const moved = new Set<Element>();
  // rolagem do documento não conta (o elemento não mudou de lugar na página)
  for (const [el, a] of prev) {
    const b = next.get(el);
    if (!b) continue;
    const dy = b.y - a.y;
    const dx = b.x - a.x;
    if (Math.abs(dy) < 1 && Math.abs(dx) < 1) continue;
    if (a.y > vh || a.y + a.h < 0) continue;
    let p = el.parentElement;
    let inner = false;
    while (p) {
      if (moved.has(p)) {
        inner = true;
        break;
      }
      p = p.parentElement;
    }
    moved.add(el);
    if (inner) continue;
    const vis = Math.max(0, Math.min(vh, a.y + a.h) - Math.max(0, a.y)) * Math.min(vw, a.w);
    const s = (vis / (vw * vh)) * Math.min(1, Math.max(Math.abs(dy), Math.abs(dx)) / Math.max(vw, vh));
    if (s < 0.0005) continue;
    state.score += s;
    const cls = typeof el.className === 'string' ? el.className.split(' ').slice(0, 4).join('.') : '';
    state.log.push({ t: Math.round(performance.now()), s: +s.toFixed(4), el: `${el.tagName.toLowerCase()}.${cls} "${(el.textContent ?? '').trim().slice(0, 30)}"`, dy: Math.round(dy) });
  }
  prev = next;
}

let last = scrollY;
setInterval(() => {
  if (scrollY !== last) {
    // rolou: recomeça a referência
    last = scrollY;
    prev = snap();
    return;
  }
  tick();
}, 100);

Object.assign(window, {
  __shifts: state,
  __shiftsReset: () => {
    state.score = 0;
    state.log = [];
    prev = snap();
  },
});

export {};
