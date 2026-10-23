// Mapa de calor: transforma os ~27 mil pontos de dots.json num campo contínuo sobre o território.
// Cada ponto carrega uma fração do eleitorado, dos votos apurados e dos votos de A da sua cidade; isso é
// espalhado numa grade e desfocado em três escalas. Em cada célula vale a escala mais fina que tem
// eleitorado suficiente por perto: detalhe de cidade onde há muita gente, e a Amazônia, com poucas cidades
// enormes, fica toda pintada pela escala larga em vez de vazia.

export type RGB = [number, number, number];

/** células na largura do mapa (1000 unidades → 2,5 unidades, ~11 km por célula) */
export const GW = 400;

export interface Field {
  gw: number;
  gh: number;
  /** tamanho da célula em unidades do mapa */
  cell: number;
  /** % de A entre A e B (50 sem dado) */
  share: Float32Array;
  /** fração do eleitorado da região já apurada (0..1) */
  prog: Float32Array;
  /** densidade de eleitores, 0..1 em escala log (relevo sutil) */
  dens: Float32Array;
}

export interface FieldInput {
  n: number;
  x: Float32Array;
  y: Float32Array;
  m: Uint16Array;
  /** pontos de cada cidade */
  perCity: Uint16Array;
}

/** hash inteiro → [0,1): sorteios fixos (ponto, célula) */
export function hash01(i: number, salt: number): number {
  let h = (i + 1) * 374761393 + salt * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** média móvel horizontal de raio r (janela [x−r, x+r], borda conta como zero) */
function boxH(s: Float32Array, d: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let acc = 0;
    for (let x = 0; x <= r && x < w; x++) acc += s[o + x];
    for (let x = 0; x < w; x++) {
      d[o + x] = acc * inv;
      if (x + r + 1 < w) acc += s[o + x + r + 1];
      if (x - r >= 0) acc -= s[o + x - r];
    }
  }
}

function boxV(s: Float32Array, d: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = 0; y <= r && y < h; y++) acc += s[y * w + x];
    for (let y = 0; y < h; y++) {
      d[y * w + x] = acc * inv;
      if (y + r + 1 < h) acc += s[(y + r + 1) * w + x];
      if (y - r >= 0) acc -= s[(y - r) * w + x];
    }
  }
}

/** três passadas de média móvel ≈ desfoque gaussiano (σ ≈ √(r²+r) células), em O(células) para qualquer raio */
function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const a = Float32Array.from(src);
  const b = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass++) {
    boxH(a, b, w, h, r);
    boxV(b, a, w, h, r);
  }
  return a;
}

/** raios das três escalas, em células: ~15 km, ~60 km, ~180 km */
const RADII = [1, 5, 16];
/**
 * eleitores por célula a partir dos quais a escala fina e a média valem sozinhas. O peso de cada escala é
 * medido na escala de cima (mais lisa): medir na própria escala faria bolhas em volta de cada ponto isolado.
 */
const TRUST = [400, 60];

export function heatField(pts: FieldInput, el: ArrayLike<number>, pst: Float32Array, pa: Float32Array, W: number, H: number, gw = GW): Field {
  const cell = W / gw;
  const gh = Math.ceil(H / cell);
  const N = gw * gh;
  const E = new Float32Array(N);
  const V = new Float32Array(N);
  const A = new Float32Array(N);
  for (let i = 0; i < pts.n; i++) {
    const m = pts.m[i];
    const f = el[m] / pts.perCity[m];
    const c = Math.min(gh - 1, (pts.y[i] / cell) | 0) * gw + Math.min(gw - 1, (pts.x[i] / cell) | 0);
    E[c] += f;
    const s = pa[m];
    if (!Number.isNaN(s)) {
      const v = (f * pst[m]) / 100;
      V[c] += v;
      A[c] += (v * s) / 100;
    }
  }
  const sc = RADII.map((r) => [blur(E, gw, gh, r), blur(V, gw, gh, r), blur(A, gw, gh, r)]);

  const share = new Float32Array(N);
  const prog = new Float32Array(N);
  const dens = new Float32Array(N);
  let maxE = 1;
  for (let c = 0; c < N; c++) maxE = Math.max(maxE, sc[1][0][c]);
  const logMax = Math.log1p(maxE);
  for (let c = 0; c < N; c++) {
    // da escala larga para a fina: cada uma sobrescreve na medida em que tem eleitorado por perto
    let s = 50;
    let p = 0;
    for (let k = RADII.length - 1; k >= 0; k--) {
      const e = sc[k][0][c];
      if (e <= 1e-6) continue;
      const v = sc[k][1][c];
      const wgt = k === RADII.length - 1 ? 1 : smooth(sc[k + 1][0][c] / TRUST[k]);
      const sk = v > 1e-6 ? (sc[k][2][c] / v) * 100 : s;
      p += (Math.min(1, v / e) - p) * wgt;
      s += (sk - s) * wgt;
    }
    share[c] = s;
    prog[c] = p;
    dens[c] = Math.log1p(sc[1][0][c]) / logMax;
  }
  return { gw, gh, cell, share, prog, dens };
}

/** ruído suave por célula (0..1): atraso da transição, para a cor se espalhar como mancha e não piscar inteira */
export function smoothNoise(gw: number, gh: number, step = 28): Float32Array {
  const nx = Math.ceil(gw / step) + 2;
  const ny = Math.ceil(gh / step) + 2;
  const lat = Float32Array.from({ length: nx * ny }, (_, i) => hash01(i, 7));
  const out = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    const fy = y / step;
    const iy = fy | 0;
    const ty = smooth(fy - iy);
    for (let x = 0; x < gw; x++) {
      const fx = x / step;
      const ix = fx | 0;
      const tx = smooth(fx - ix);
      const a = lat[iy * nx + ix] + (lat[iy * nx + ix + 1] - lat[iy * nx + ix]) * tx;
      const b = lat[(iy + 1) * nx + ix] + (lat[(iy + 1) * nx + ix + 1] - lat[(iy + 1) * nx + ix]) * tx;
      out[y * gw + x] = a + (b - a) * ty;
    }
  }
  return out;
}

export interface Palette {
  a: RGB;
  b: RGB;
  /** sem nada apurado */
  pending: RGB;
  /** fundo do cartão (onde há pouca gente a cor puxa levemente para ele) */
  card: RGB;
}

/** posição na escala B → A (0..1) para cada % de A ×10: S suave em torno do empate, satura perto de 65–35 */
const SHARE_LUT = Float32Array.from({ length: 1001 }, (_, i) => 0.5 + 0.5 * Math.tanh((i / 10 - 50) / 11));
/** quanto da cor aparece conforme a fração apurada: sobe rápido no começo */
const PROG_LUT = Float32Array.from({ length: 256 }, (_, i) => (i / 255) ** 0.6);

export const scalePos = (share: number) => SHARE_LUT[Math.max(0, Math.min(1000, Math.round(share * 10)))];

/** pinta o campo num ImageData do tamanho da grade: azul → roxo (dividido) → vermelho, cinza sem apuração */
export function paintField(img: ImageData, share: Float32Array, prog: Float32Array, dens: Float32Array, pal: Palette) {
  const d = img.data;
  const [ar, ag, ab] = pal.a;
  const [br, bg, bb] = pal.b;
  const [pr, pg, pb] = pal.pending;
  const [cr, cg, cb] = pal.card;
  for (let c = 0, o = 0; c < share.length; c++, o += 4) {
    const u = SHARE_LUT[Math.max(0, Math.min(1000, (share[c] * 10 + 0.5) | 0))];
    let r = br + (ar - br) * u;
    let g = bg + (ag - bg) * u;
    let b = bb + (ab - bb) * u;
    // relevo: onde mora pouca gente a cor fica um pouco mais discreta, sem sumir
    const k = 0.78 + 0.22 * dens[c];
    r = cr + (r - cr) * k;
    g = cg + (g - cg) * k;
    b = cb + (b - cb) * k;
    const q = PROG_LUT[Math.max(0, Math.min(255, (prog[c] * 255 + 0.5) | 0))];
    d[o] = pr + (r - pr) * q;
    d[o + 1] = pg + (g - pg) * q;
    d[o + 2] = pb + (b - pb) * q;
    d[o + 3] = 255;
  }
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

export const mixRgb = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const rgbCss = ([r, g, b]: RGB) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

// ---------------------------------------------------------------- mosaico de cidades (zoom)

export interface Mosaic {
  /** canto da grade em unidades do mapa, tamanho da célula e da grade */
  x0: number;
  y0: number;
  cell: number;
  gw: number;
  gh: number;
  /** cidade de cada célula (-1 sem ponto por perto) */
  city: Int32Array;
}

/**
 * Com zoom, o calor se resolve em cidades: cada célula fica com a cidade do ponto mais próximo. Como os pontos
 * de cada cidade estão em grade dentro do contorno dela, esse Voronoi dos pontos aproxima bem os limites dos
 * municípios. Calculado por "jump flooding" (log2 do lado em passadas), só para a região em volta da tela.
 */
export function cityMosaic(pts: FieldInput, x0: number, y0: number, x1: number, y1: number, gw: number): Mosaic {
  const cell = (x1 - x0) / gw;
  const gh = Math.max(1, Math.ceil((y1 - y0) / cell));
  const N = gw * gh;
  let near = new Int32Array(N).fill(-1);
  let next = new Int32Array(N);
  const d2 = (c: number, i: number) => {
    const cx = x0 + ((c % gw) + 0.5) * cell;
    const cy = y0 + (((c / gw) | 0) + 0.5) * cell;
    return (pts.x[i] - cx) ** 2 + (pts.y[i] - cy) ** 2;
  };
  for (let i = 0; i < pts.n; i++) {
    const gx = Math.floor((pts.x[i] - x0) / cell);
    const gy = Math.floor((pts.y[i] - y0) / cell);
    if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) continue;
    const c = gy * gw + gx;
    if (near[c] < 0 || d2(c, i) < d2(c, near[c])) near[c] = i;
  }
  // o maior vão entre pontos vizinhos (Amazônia) fica abaixo de ~60 unidades: saltos maiores que isso não mudam nada
  let step = 1;
  while (step * 2 < Math.min(Math.max(gw, gh), 64 / cell)) step *= 2;
  // passadas com salto decrescente, mais uma de salto 1 para corrigir os poucos erros do método
  const steps: number[] = [];
  for (let s = step; s >= 1; s >>= 1) steps.push(s);
  steps.push(1);
  for (const s of steps) {
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const c = y * gw + x;
        let best = near[c];
        let bd = best >= 0 ? d2(c, best) : Infinity;
        for (let dy = -s; dy <= s; dy += s) {
          const yy = y + dy;
          if (yy < 0 || yy >= gh) continue;
          for (let dx = -s; dx <= s; dx += s) {
            const xx = x + dx;
            if (xx < 0 || xx >= gw || (dx === 0 && dy === 0)) continue;
            const i = near[yy * gw + xx];
            if (i < 0 || i === best) continue;
            const d = d2(c, i);
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
        }
        next[c] = best;
      }
    [near, next] = [next, near];
  }
  const city = new Int32Array(N);
  for (let c = 0; c < N; c++) city[c] = near[c] < 0 ? -1 : pts.m[near[c]];
  return { x0, y0, cell, gw, gh, city };
}

/**
 * pinta o mosaico com a mesma escala de cor do calor; limites entre cidades como linhas finas na cor do
 * cartão, e o contorno da cidade escolhida na cor do texto
 */
export function paintMosaic(
  img: ImageData,
  mo: Mosaic,
  pst: Float32Array,
  pa: Float32Array,
  pal: Palette,
  ink: RGB,
  picked: number | null,
  /** força da linha entre cidades (0..1): mais leve com pouco zoom, quando as cidades são pequenas na tela */
  line: number,
) {
  const { gw, gh, city } = mo;
  const share = new Float32Array(1);
  const prog = new Float32Array(1);
  const one = new Float32Array([1]);
  const px = new ImageData(1, 1);
  const d = img.data;
  // cor por cidade, calculada uma vez
  const cache = new Map<number, RGB>();
  const colorOf = (m: number): RGB => {
    let c = cache.get(m);
    if (!c) {
      const s = pa[m];
      share[0] = Number.isNaN(s) ? 50 : s;
      prog[0] = Number.isNaN(s) ? 0 : pst[m] / 100;
      paintField(px, share, prog, one, pal);
      c = [px.data[0], px.data[1], px.data[2]];
      cache.set(m, c);
    }
    return c;
  };
  for (let y = 0, o = 0; y < gh; y++)
    for (let x = 0; x < gw; x++, o += 4) {
      const c = y * gw + x;
      const m = city[c];
      if (m < 0) {
        d[o + 3] = 0;
        continue;
      }
      let [r, g, b] = colorOf(m);
      const right = x + 1 < gw ? city[c + 1] : m;
      const down = y + 1 < gh ? city[c + gw] : m;
      // borda da cidade escolhida: células dela que encostam em outra cidade
      const left = x > 0 ? city[c - 1] : m;
      const up = y > 0 ? city[c - gw] : m;
      if (m === picked && (right !== m || down !== m || left !== m || up !== m)) {
        [r, g, b] = ink;
      } else if (right !== m || down !== m) {
        r = r + (pal.card[0] - r) * line;
        g = g + (pal.card[1] - g) * line;
        b = b + (pal.card[2] - b) * line;
      }
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
      d[o + 3] = 255;
    }
}
