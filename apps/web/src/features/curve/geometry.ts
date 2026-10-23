// Geometria do gráfico da noite (pura, testável).

export type XY = [number, number];

/** Spline monotônica (Fritsch–Carlson): suave sem "ultrapassar" os dados. */
export function monotonePath(pts: XY[]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  if (n === 2) return `M${pts[0][0]},${pts[0][1]}L${pts[1][0]},${pts[1][1]}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0] || 1e-6);
    m.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const h = a * a + b * b;
    if (h > 9) {
      const k = 3 / Math.sqrt(h);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = dx[i] / 3;
    d += `C${(x0 + h).toFixed(1)},${(y0 + t[i] * h).toFixed(1)} ${(x1 - h).toFixed(1)},${(y1 - t[i + 1] * h).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

/** Domínio simétrico em torno de 50% com folga; passo dos ticks 2, 5 ou 10. */
export function yDomain(values: number[]): { lo: number; hi: number; ticks: number[] } {
  const dev = values.length ? Math.max(...values.map((v) => Math.abs(v - 50))) : 0;
  const raw = Math.max(4, dev + 1.5);
  const step = raw <= 6 ? 2 : raw <= 15 ? 5 : 10;
  const half = Math.ceil(raw / step) * step;
  const ticks: number[] = [];
  for (let v = 50 - half + step; v < 50 + half; v += step) ticks.push(v);
  return { lo: 50 - half, hi: 50 + half, ticks };
}

/**
 * Separa dois rótulos verticalmente (anti-colisão): mantém o centro entre eles e
 * garante `gap` px, sem sair de [min, max].
 */
export function separate(ya: number, yb: number, gap: number, min: number, max: number): [number, number] {
  let a = ya;
  let b = yb;
  if (Math.abs(a - b) < gap) {
    const mid = (a + b) / 2;
    const aAbove = a <= b;
    a = mid + (aAbove ? -gap / 2 : gap / 2);
    b = mid + (aAbove ? gap / 2 : -gap / 2);
  }
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  // se o clamp aproximou de novo, empurra o outro
  a = clamp(a);
  b = clamp(b);
  if (Math.abs(a - b) < gap) {
    if (a < b) b = Math.min(max, a + gap);
    else a = Math.min(max, b + gap);
    if (Math.abs(a - b) < gap) {
      if (a < b) a = Math.max(min, b - gap);
      else b = Math.max(min, a - gap);
    }
  }
  return [a, b];
}

/** ponto mais próximo de x numa série ordenada por x (null fora do intervalo) */
export function nearest<T extends { x: number }>(pts: T[], x: number, tolerance = Infinity): T | null {
  if (!pts.length) return null;
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].x < x) lo = mid;
    else hi = mid;
  }
  const best = Math.abs(pts[lo].x - x) <= Math.abs(pts[hi].x - x) ? pts[lo] : pts[hi];
  return Math.abs(best.x - x) <= tolerance ? best : null;
}
