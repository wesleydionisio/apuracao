// Grade hexagonal do Brasil: o território vira um mosaico de hexágonos do mesmo tamanho. Cada hexágono soma o
// eleitorado, os votos apurados e os votos de A dos pontos de cidade que caem nele (dots.json); hexágono sem
// ponto (Amazônia, onde as cidades são enormes) herda do vizinho com dado mais próximo, então nenhum estado
// fica vazio. Três tamanhos de hexágono, um para cada faixa de zoom.

export type RGB = [number, number, number];

export interface DotsInput {
  n: number;
  x: Float32Array;
  y: Float32Array;
  m: Uint16Array;
  /** pontos de cada cidade */
  perCity: Uint16Array;
}

export interface HexLevel {
  /** raio (centro → vértice) em unidades do mapa */
  R: number;
  n: number;
  /** os primeiros `filled` hexágonos têm pontos; os demais herdam de `src` */
  filled: number;
  cx: Float32Array;
  cy: Float32Array;
  /** hexágono de cada ponto */
  ofDot: Int32Array;
  /** hexágono com dado que vale para este (ele mesmo, se tem ponto; -1 se ilhado) */
  src: Int32Array;
  /** cidade com mais eleitores no hexágono (ou na origem do dado): toque e destaque */
  city: Int32Array;
  /** grade (coluna, linha) → hexágono, para achar o hexágono sob o dedo */
  cols: number;
  rows: number;
  grid: Int32Array;
}

const SQ3 = Math.sqrt(3);

/** hash inteiro → [0,1): sorteios fixos */
export function hash01(i: number, salt: number): number {
  let h = (i + 1) * 374761393 + salt * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** hexágono (coluna, linha) que contém o ponto: linhas ímpares deslocadas meia coluna, vértice para cima */
export function hexAt(R: number, x: number, y: number): [number, number] {
  const dx = SQ3 * R;
  const dy = 1.5 * R;
  const j0 = Math.round(y / dy);
  let bi = 0;
  let bj = 0;
  let bd = Infinity;
  for (let j = j0 - 1; j <= j0 + 1; j++) {
    const off = j & 1 ? dx / 2 : 0;
    const i = Math.round((x - off) / dx);
    const d = (i * dx + off - x) ** 2 + (j * dy - y) ** 2;
    if (d < bd) {
      bd = d;
      bi = i;
      bj = j;
    }
  }
  return [bi, bj];
}

/** vizinhos de um hexágono numa linha par / ímpar */
const NB = [
  [
    [1, 0],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [-1, 1],
    [0, 1],
  ],
  [
    [1, 0],
    [-1, 0],
    [0, -1],
    [1, -1],
    [0, 1],
    [1, 1],
  ],
];

/**
 * Monta um nível: hexágonos com pontos, mais os de dentro do contorno do Brasil (`mask`, 1 byte por unidade
 * do mapa), e a herança dos vazios por busca em largura a partir dos que têm dado.
 */
export function buildLevel(pts: DotsInput, el: ArrayLike<number>, mask: Uint8Array, mw: number, mh: number, R: number): HexLevel {
  const dx = SQ3 * R;
  const dy = 1.5 * R;
  const cols = Math.ceil(mw / dx) + 2;
  const rows = Math.ceil(mh / dy) + 2;
  const grid = new Int32Array(cols * rows).fill(-1);
  const cx: number[] = [];
  const cy: number[] = [];
  const gi: number[] = [];
  const gj: number[] = [];
  const add = (i: number, j: number) => {
    const k = j * cols + i;
    if (grid[k] < 0) {
      grid[k] = cx.length;
      cx.push(i * dx + (j & 1 ? dx / 2 : 0));
      cy.push(j * dy);
      gi.push(i);
      gj.push(j);
    }
    return grid[k];
  };
  const ofDot = new Int32Array(pts.n);
  for (let d = 0; d < pts.n; d++) {
    const [i, j] = hexAt(R, pts.x[d], pts.y[d]);
    ofDot[d] = add(Math.max(0, Math.min(cols - 1, i)), Math.max(0, Math.min(rows - 1, j)));
  }
  const filled = cx.length;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const x = i * dx + (j & 1 ? dx / 2 : 0);
      const y = j * dy;
      if (x < mw && y < mh && mask[(y | 0) * mw + (x | 0)]) add(i, j);
    }
  const n = cx.length;

  // cidade principal de cada hexágono com pontos
  const best = new Int32Array(n).fill(-1);
  const bestW = new Float32Array(n);
  const acc = new Map<number, number>();
  for (let d = 0; d < pts.n; d++) {
    const h = ofDot[d];
    const m = pts.m[d];
    const key = h * 8192 + m;
    const w = (acc.get(key) ?? 0) + el[m] / pts.perCity[m];
    acc.set(key, w);
    if (w > bestW[h]) {
      bestW[h] = w;
      best[h] = m;
    }
  }

  // vazios herdam do hexágono com dado mais próximo (busca em largura na grade)
  const src = new Int32Array(n).fill(-1);
  const q = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  for (let h = 0; h < filled; h++) {
    src[h] = h;
    q[qt++] = h;
  }
  while (qh < qt) {
    const h = q[qh++];
    for (const [a, b] of NB[gj[h] & 1]) {
      const ii = gi[h] + a;
      const jj = gj[h] + b;
      if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue;
      const k = grid[jj * cols + ii];
      if (k >= 0 && src[k] < 0) {
        src[k] = src[h];
        q[qt++] = k;
      }
    }
  }
  const city = new Int32Array(n);
  for (let h = 0; h < n; h++) city[h] = src[h] < 0 ? -1 : best[src[h]];
  return { R, n, filled, cx: Float32Array.from(cx), cy: Float32Array.from(cy), ofDot, src, city, cols, rows, grid };
}

/** hexágono do nível sob o ponto do mapa (-1 fora do Brasil) */
export function hexUnder(L: HexLevel, x: number, y: number): number {
  const [i, j] = hexAt(L.R, x, y);
  if (i < 0 || j < 0 || i >= L.cols || j >= L.rows) return -1;
  return L.grid[j * L.cols + i];
}

/**
 * % de A (`share`, NaN sem votos) e fração apurada (`prog`, 0..1) de cada hexágono: soma dos pontos dele, ou
 * do hexágono de onde herda
 */
export function hexValues(L: HexLevel, pts: DotsInput, el: ArrayLike<number>, pst: Float32Array, pa: Float32Array) {
  const { n, filled, ofDot, src } = L;
  const E = new Float32Array(filled);
  const C = new Float32Array(filled);
  const V = new Float32Array(filled);
  const A = new Float32Array(filled);
  for (let d = 0; d < pts.n; d++) {
    const h = ofDot[d];
    const m = pts.m[d];
    const f = el[m] / pts.perCity[m];
    const c = (f * pst[m]) / 100;
    E[h] += f;
    C[h] += c;
    if (!Number.isNaN(pa[m])) {
      V[h] += c;
      A[h] += (c * pa[m]) / 100;
    }
  }
  const share = new Float32Array(n);
  const prog = new Float32Array(n);
  for (let h = 0; h < n; h++) {
    const s = h < filled ? h : src[h];
    if (s < 0) {
      share[h] = NaN;
      continue;
    }
    share[h] = V[s] > 0 ? (A[s] / V[s]) * 100 : NaN;
    prog[h] = E[s] > 0 ? Math.min(1, C[s] / E[s]) : 0;
  }
  return { share, prog };
}

/** vértices de um hexágono de raio 1 com vértice para cima */
export const HEX_X = Array.from({ length: 6 }, (_, k) => Math.cos(Math.PI / 6 + (k * Math.PI) / 3));
export const HEX_Y = Array.from({ length: 6 }, (_, k) => Math.sin(Math.PI / 6 + (k * Math.PI) / 3));

export function hexPath(p: Path2D, x: number, y: number, r: number) {
  p.moveTo(x + HEX_X[0] * r, y + HEX_Y[0] * r);
  for (let k = 1; k < 6; k++) p.lineTo(x + HEX_X[k] * r, y + HEX_Y[k] * r);
  p.closePath();
}

// ---------------------------------------------------------------- cor

const toLin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLin = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklch([r, g, b]: RGB): [number, number, number] {
  const [lr, lg, lb] = [toLin(r), toLin(g), toLin(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

function lin([L, C, H]: [number, number, number]): [number, number, number] {
  const A = C * Math.cos(H);
  const B = C * Math.sin(H);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH → sRGB, baixando o croma até caber (mantém matiz e luminosidade em vez de cortar canal) */
function fromOklch(c: [number, number, number]): RGB {
  let [L, C, H] = c;
  let v = lin([L, C, H]);
  for (let i = 0; i < 24 && v.some((x) => x < -1e-4 || x > 1 + 1e-4); i++) {
    C *= 0.94;
    v = lin([L, C, H]);
  }
  return v.map((x) => Math.round(Math.max(0, Math.min(1, fromLin(x))) * 255)) as RGB;
}

/**
 * Três tons da cor do candidato, do mais forte (vantagem grande) ao mais fechado (disputa apertada). Mesmo
 * matiz e croma alto: o tom muda pela luminosidade, nunca puxando para cinza.
 */
export function shades(base: RGB): [RGB, RGB, RGB] {
  const [L, C, H] = oklch(base);
  return [base, fromOklch([L - 0.075, C * 0.97, H]), fromOklch([L - 0.15, C * 0.93, H])];
}

/** qualquer cor CSS (hex, rgb, oklch…) → RGB, pelo próprio canvas */
export function toRgb(css: string): RGB {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

export const rgbCss = ([r, g, b]: RGB) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

/** faixas de vantagem (pontos entre os dois) para os três tons */
export const HEX_BANDS = [20, 6] as const;
export const bandOfMargin = (m: number) => (m >= HEX_BANDS[0] ? 0 : m >= HEX_BANDS[1] ? 1 : 2);
