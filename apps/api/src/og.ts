// Cards PNG para compartilhar (palpite em 9:16, 3:4 e 16:9; OG 1200×630). satori → SVG → resvg → PNG.
// Mesmo visual do site: grafite, fotos oficiais do TSE, um número protagonista, barra bicolor.
// Cache por chave de conteúdo (disco; palpites só em memória): cada card é gerado uma vez por versão dos dados.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { fmtBrt, fmtPct, type CandidateDef, type Snap } from '@apuracao/shared';
import { config } from './config';

type Node = { type: string; props: Record<string, unknown> };
type Child = Node | string | null | false | undefined;
type Style = Record<string, string | number>;

const h = (style: Style, ...children: Child[]): Node => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children: children.filter((c) => c !== null && c !== false && c !== undefined) },
});

/** muda quando o desenho muda: invalida o cache em disco dos cards antigos */
const DESIGN = 'v5';

let fonts: { name: string; data: Buffer; weight: 400 | 800; style: 'normal' }[] | null = null;
function loadFonts() {
  if (fonts) return fonts;
  const f = (w: 400 | 800) => readFileSync(path.join(config.fontsDir, `inter-${w}.woff`));
  fonts = [
    { name: 'Inter', data: f(400), weight: 400, style: 'normal' },
    { name: 'Inter', data: f(800), weight: 800, style: 'normal' },
  ];
  return fonts;
}

/** satori não desenha emoji sem fonte extra: removemos dos textos dos cards */
export const stripEmoji = (s: string) => s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();

// paleta = tema escuro do site
const BG = '#0f1216';
const CARD = '#161a20';
const LINE = '#262c35';
const FG = '#eef1f5';
const MUTED = '#8b95a1';

/** story 9:16, portrait 3:4, wide 16:9: os formatos do pôster de palpite; og: a prévia do link */
export type Poster = 'story' | 'portrait' | 'wide';
export type Format = 'og' | Poster;
export const POSTERS: Poster[] = ['story', 'portrait', 'wide'];
const SIZE: Record<Format, [number, number]> = { og: [1200, 630], story: [1080, 1920], portrait: [1080, 1440], wide: [1920, 1080] };

const host = () => new URL(config.publicUrl).host;

// ---------------------------------------------------------------- fotos

const photoCache = new Map<string, string | null>();
/** foto oficial (apps/web/public/cand/<n>.jpg) como data URI; null se o ETL não baixou */
function photoUri(c: CandidateDef): string | null {
  if (photoCache.has(c.n)) return photoCache.get(c.n)!;
  const file = path.join(config.repo, 'apps/web/public/cand', `${c.n}.jpg`);
  const uri = existsSync(file) ? `data:image/jpeg;base64,${readFileSync(file).toString('base64')}` : null;
  photoCache.set(c.n, uri);
  return uri;
}

/** retrato 161×225 recortado em quadrado no rosto (objectPosition não é confiável no satori) */
function photo(c: CandidateDef, size: number, radius: number, ring = false): Node {
  const uri = photoUri(c);
  const inner = uri
    ? {
        type: 'img',
        props: { src: uri, width: size, height: Math.round((size * 225) / 161), style: { marginTop: -Math.round(size * 0.06) } },
      }
    : h({ fontSize: size * 0.4, fontWeight: 800, color: '#fff' }, c.short.charAt(0));
  return h(
    {
      width: size,
      height: size,
      borderRadius: radius,
      overflow: 'hidden',
      background: uri ? '#fff' : c.color,
      alignItems: uri ? 'flex-start' : 'center',
      justifyContent: 'center',
      flexShrink: 0,
      border: ring ? `${Math.max(3, Math.round(size / 28))}px solid ${c.color}` : `1px solid ${LINE}`,
    },
    inner as Node,
  );
}

// ---------------------------------------------------------------- peças

function bar(pa: number, ca: CandidateDef, cb: CandidateDef, height: number): Node {
  const w = Math.max(0, Math.min(100, pa));
  return h(
    { position: 'relative', width: '100%', height, borderRadius: height / 2, overflow: 'hidden', background: LINE },
    h({ width: `${w}%`, height: '100%', background: ca.color }),
    h({ flexGrow: 1, height: '100%', background: cb.color }),
    // 50%: a linha de chegada
    h({ position: 'absolute', left: '50%', top: 0, width: Math.max(3, height / 5), height: '100%', marginLeft: -Math.max(3, height / 5) / 2, background: BG }),
  );
}

function dot(color: string, size: number): Node {
  return h({ width: size, height: size, borderRadius: size / 2, background: color, flexShrink: 0 });
}

/** linha de candidato (g1 + mercado): foto, nome/partido, % grande à direita */
function candRow(c: CandidateDef, pct: number | null, o: { lead: boolean; dim: boolean; photo: number; name: number; big: number; votes?: string; digits?: number }): Node {
  return h(
    { alignItems: 'center', gap: Math.round(o.photo * 0.26), width: '100%' },
    photo(c, o.photo, Math.round(o.photo * 0.22), o.lead),
    h(
      { flexDirection: 'column', flexGrow: 1, gap: 4 },
      h({ alignItems: 'center', gap: 12, fontSize: o.name, fontWeight: 800, color: FG }, dot(c.color, Math.round(o.name * 0.4)), c.short),
      h({ fontSize: Math.round(o.name * 0.62), color: MUTED }, [c.party, o.votes].filter(Boolean).join(' · ') || ' '),
    ),
    pct === null
      ? null
      : h({ fontSize: o.big, fontWeight: 800, letterSpacing: -o.big * 0.04, color: o.dim ? MUTED : FG, lineHeight: 1 }, `${fmtPct(pct, o.digits ?? 1)}%`),
  );
}

function header(left: string, right: string, size: number): Node {
  return h(
    { justifyContent: 'space-between', alignItems: 'center', fontSize: size, color: MUTED },
    h({ alignItems: 'center', gap: 14 }, h({ fontWeight: 800, color: FG }, 'urna.digi'), left),
    h({}, right),
  );
}

function footer(left: string, size: number): Node {
  return h(
    { justifyContent: 'space-between', alignItems: 'center', fontSize: size, color: MUTED, borderTop: `1px solid ${LINE}`, paddingTop: Math.round(size * 0.9) },
    h({}, left),
    h({ fontWeight: 800, color: FG }, host()),
  );
}

async function render(node: Node, fmt: Format): Promise<Buffer> {
  const [w, hgt] = SIZE[fmt];
  const svg = await satori(node as never, { width: w, height: hgt, fonts: loadFonts() });
  // o satori já entrega o texto como caminhos: sem isso o resvg varre as fontes do sistema a cada card (>1 s de CPU)
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: w }, font: { loadSystemFonts: false } }).render().asPng());
}

const cacheDir = () => path.join(config.varDir, 'og');

/** cards de palpite: um por pessoa, então ficam só na memória (no disco seriam ~300 KB × cada palpite) */
const MEM_MAX = 200;
const mem = new Map<string, Buffer>();
/** o mesmo card pedido por várias pessoas ao mesmo tempo renderiza uma vez só */
const inflight = new Map<string, Promise<Buffer>>();

/** fila com um render por vez: o render ocupa a CPU e a API tem de seguir respondendo palpites e login */
const QUEUE_MAX = 20;
let running = 0;
const waiting: (() => void)[] = [];
export class Busy extends Error {}
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running > 0) {
    if (waiting.length >= QUEUE_MAX) throw new Busy('fila de cards cheia');
    await new Promise<void>((r) => waiting.push(r));
  }
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/**
 * Gera (ou devolve do cache) o PNG da chave; `build` só roda em cache miss. `disk: false` guarda só num LRU em memória.
 * Lança `Busy` quando a fila de renders está cheia (a rota responde 503 e a CDN/cliente tenta de novo).
 */
export async function cached(kind: string, keyData: unknown, build: () => Promise<Buffer>, disk = true): Promise<Buffer> {
  const key = `${kind}-${createHash('sha1').update(JSON.stringify([DESIGN, keyData])).digest('hex').slice(0, 20)}`;
  const file = path.join(cacheDir(), `${key}.png`);
  const hit = mem.get(key);
  if (hit) {
    mem.delete(key);
    mem.set(key, hit);
    return hit;
  }
  if (disk && existsSync(file)) return readFile(file);
  const busy = inflight.get(key);
  if (busy) return busy;
  const job = slot(build)
    .then(async (png) => {
      if (disk) {
        mkdirSync(cacheDir(), { recursive: true });
        await writeFile(file, png);
      } else {
        mem.set(key, png);
        if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value!);
      }
      return png;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** "top 2% do Brasil" quando vale a pena mostrar; senão a posição */
export function rankLine(rank: number, total: number): string {
  const top = (rank / Math.max(1, total)) * 100;
  if (total >= 20 && top <= 50) return `top ${fmtPct(Math.max(0.01, top), top < 1 ? 2 : 0)}% do Brasil`;
  return `${rank.toLocaleString('pt-BR')}º de ${total.toLocaleString('pt-BR')} palpites`;
}

// ---------------------------------------------------------------- palpite

export function guessCard(
  fmt: Format,
  o: { nick: string; pa: number; cands: CandidateDef[]; result?: { pa: number; dist: number; rank: number; total: number } },
) {
  return fmt === 'og' ? guessOg(o) : guessPoster(fmt, o);
}

type GuessIn = Parameters<typeof guessCard>[1];

const headline = (o: GuessIn) =>
  o.result ? (o.result.dist < 0.005 ? 'Na mosca!' : `Errei por ${fmtPct(o.result.dist, 2)} ponto${o.result.dist >= 2 ? 's' : ''}`) : `Meu palpite para o 2º turno`;

/**
 * Pôster do palpite, feito para circular: a aposta em letras grandes ("Flavio Bolsonaro vence com 52,2%"), o duelo
 * com o brilho da cor de cada lado e o desafio ("Duvido você chegar mais perto") com o endereço. Depois do TSE, o
 * mesmo pôster vira o resultado: quanto errou, a posição no ranking e o placar oficial ao lado do palpite.
 */
function guessPoster(fmt: Poster, o: GuessIn) {
  const [ca, cb] = o.cands;
  const pb = 100 - o.pa;
  const wide = fmt === 'wide';
  const story = fmt === 'story';
  const [W, H] = SIZE[fmt];
  const pad = wide ? 88 : 80;
  const r = o.result;
  const win = o.pa > 50 ? ca : pb > 50 ? cb : null;
  const winPct = Math.max(o.pa, pb);
  // largura útil da coluna de texto
  const col = wide ? 900 : W - pad * 2;
  /** maior corpo em que o texto cabe numa linha (Inter 800 ≈ 0,6 em por letra) */
  const fit = (text: string, max: number) => Math.min(max, Math.floor(col / (text.length * 0.6)));

  const brand = h(
    { justifyContent: 'space-between', alignItems: 'center' },
    h(
      { alignItems: 'center', gap: 18 },
      h({ fontSize: 40, fontWeight: 800, letterSpacing: -1.2 }, 'urna.digi'),
      h({ fontSize: 22, color: MUTED, letterSpacing: 4 }, '2º TURNO'),
    ),
    h(
      { alignItems: 'center', gap: 12, fontSize: 22, fontWeight: 800, letterSpacing: 2, border: `1px solid ${LINE}`, borderRadius: 999, padding: '12px 24px', background: `${CARD}cc` },
      dot(r ? FG : '#22c55e', 14),
      r ? 'RESULTADO OFICIAL' : 'APURAÇÃO AO VIVO · 25/10 · 19H',
    ),
  );

  const kicker = h(
    { alignItems: 'center', gap: 16, fontSize: 30 },
    h({ fontWeight: 800, letterSpacing: 3, color: BG, background: FG, borderRadius: 10, padding: '8px 16px' }, r ? 'MEU RESULTADO' : 'MEU PALPITE'),
    h({ color: MUTED }, o.nick),
  );

  // a frase da aposta: o nome de quem vence e a porcentagem na cor dele
  const big = wide ? 104 : story ? 112 : 100;
  const head = r
    ? h(
        { flexDirection: 'column', gap: 18 },
        h({ fontSize: fit(headline(o), big), fontWeight: 800, letterSpacing: -3, lineHeight: 1 }, headline(o)),
        h(
          { alignSelf: 'flex-start', fontSize: wide ? 44 : 48, fontWeight: 800, color: BG, background: '#facc15', borderRadius: 16, padding: '10px 22px' },
          rankLine(r.rank, r.total),
        ),
      )
    : win
      ? h(
          { flexDirection: 'column' },
          h({ fontSize: fit(win.short, big), fontWeight: 800, letterSpacing: -3.5, lineHeight: 1.02 }, win.short),
          h(
            { fontSize: big * 0.86, fontWeight: 800, letterSpacing: -3, lineHeight: 1.08 },
            h({ color: MUTED, marginRight: big * 0.25 }, 'vence com'),
            h({ color: win.color }, `${fmtPct(winPct, 1)}%`),
          ),
        )
      : h({ fontSize: big, fontWeight: 800, letterSpacing: -3.5, lineHeight: 1.02 }, 'Empate: 50 × 50');

  // o duelo: retrato maior e com brilho para quem o palpite põe na frente
  const ph = wide ? 260 : story ? 300 : 230;
  const side = (c: CandidateDef, p: number) => {
    const lead = p > 50;
    return h(
      { flexDirection: 'column', alignItems: 'center', gap: wide ? 18 : 20, flexGrow: 1, flexBasis: 0 },
      h(
        { position: 'relative' },
        // brilho atrás do retrato: um gradiente pequeno (boxShadow com blur grande leva >20 s no resvg)
        lead
          ? h({
              position: 'absolute',
              left: -ph * 0.45,
              top: -ph * 0.45,
              width: ph * 1.9 + 14,
              height: ph * 1.9 + 14,
              backgroundImage: `radial-gradient(circle, ${c.color}99 0%, ${c.color}33 40%, transparent 68%)`,
            })
          : null,
        h(
          { borderRadius: ph * 0.24, padding: 7, background: lead ? c.color : LINE, opacity: p < 50 ? 0.6 : 1 },
          photo(c, ph, ph * 0.21),
        ),
      ),
      h({ fontSize: wide ? 34 : 36, fontWeight: 800, color: p < 50 ? MUTED : FG }, c.short),
      h({ fontSize: wide ? 96 : story ? 108 : 92, fontWeight: 800, letterSpacing: -4, lineHeight: 1, color: p < 50 ? MUTED : FG }, `${fmtPct(p, 1)}%`),
    );
  };
  const duel = h(
    {
      flexDirection: 'column',
      gap: wide ? 34 : 38,
      background: `${CARD}e6`,
      border: `1px solid ${LINE}`,
      borderRadius: 48,
      padding: wide ? '52px 48px' : story ? '60px 44px' : '44px 40px',
      width: wide ? 760 : '100%',
    },
    h(
      { alignItems: 'flex-start' },
      side(ca, o.pa),
      h({ fontSize: 44, fontWeight: 800, color: MUTED, marginTop: ph * 0.42 }, '×'),
      side(cb, pb),
    ),
    bar(o.pa, ca, cb, wide ? 26 : 30),
    r
      ? h(
          { justifyContent: 'center', alignItems: 'center', gap: 14, fontSize: 32, color: MUTED },
          'TSE:',
          h({ fontWeight: 800, color: FG }, `${ca.short} ${fmtPct(r.pa, 2)}% × ${fmtPct(100 - r.pa, 2)}% ${cb.short}`),
        )
      : null,
  );

  const dare = h(
    { flexDirection: 'column', gap: 14 },
    h({ fontSize: wide ? 56 : 58, fontWeight: 800, letterSpacing: -1.6, lineHeight: 1.05 }, r ? 'E você, quanto errou?' : 'Duvido você chegar mais perto.'),
    h(
      { fontSize: 32, color: MUTED, lineHeight: 1.3 },
      r ? 'O ranking com todos os palpites está no site.' : 'Quem errar menos sobe no ranking ao vivo da apuração.',
    ),
  );
  const cta = h(
    { alignSelf: wide ? 'flex-start' : 'stretch', justifyContent: 'center', alignItems: 'center', gap: 18, background: FG, color: BG, borderRadius: 999, padding: '28px 48px', fontSize: 38, fontWeight: 800 },
    r ? 'Veja o seu em' : 'Faça o seu em',
    h({ color: win?.color ?? BG }, host()),
  );
  const foot = h({ justifyContent: 'center', fontSize: 24, color: MUTED }, 'Placar e chat ao vivo · dados oficiais do TSE');

  // cada lado com a cor do seu candidato (gradiente linear: o radial na tela inteira custa ~1 s no resvg)
  const bg = `linear-gradient(90deg, ${ca.color}40 0%, ${ca.color}10 30%, transparent 48%, transparent 52%, ${cb.color}10 70%, ${cb.color}40 100%)`;
  const frame: Style = { width: W, height: H, background: BG, backgroundImage: bg, color: FG, fontFamily: 'Inter', padding: pad };

  return render(
    wide
      ? h(
          { ...frame, flexDirection: 'column', gap: 40 },
          brand,
          h(
            { flexGrow: 1, alignItems: 'center', justifyContent: 'space-between' },
            h({ flexDirection: 'column', gap: 40, width: col }, kicker, head, dare, cta),
            duel,
          ),
        )
      : h(
          { ...frame, flexDirection: 'column', justifyContent: 'space-between' },
          brand,
          h({ flexDirection: 'column', gap: story ? 34 : 26 }, kicker, head),
          duel,
          h({ flexDirection: 'column', gap: story ? 40 : 30 }, dare, cta),
          story ? foot : null,
        ),
    fmt,
  );
}

function guessOg(o: GuessIn) {
  const [ca, cb] = o.cands;
  const pb = 100 - o.pa;
  const row = (c: CandidateDef, p: number) => candRow(c, p, { lead: p > 50, dim: p < 50, photo: 96, name: 34, big: 76 });
  return render(
    h(
      { width: 1200, height: 630, background: BG, color: FG, fontFamily: 'Inter', flexDirection: 'column', padding: '48px 64px', gap: 24 },
      header('· 2º turno · palpite', o.result ? rankLine(o.result.rank, o.result.total) : '25 de outubro', 22),
      h(
        { flexDirection: 'column', gap: 4 },
        h({ fontSize: 24, color: MUTED }, o.result ? `${o.nick} · resultado` : `Palpite de ${o.nick}`),
        h({ fontSize: 46, fontWeight: 800, letterSpacing: -1.5 }, headline(o)),
      ),
      h({ flexDirection: 'column', gap: 18, flexGrow: 1, justifyContent: 'center' }, row(ca, o.pa), row(cb, pb), bar(o.pa, ca, cb, 14)),
      footer(o.result ? `Resultado TSE: ${ca.short} ${fmtPct(o.result.pa, 2)}%` : 'Faça seu palpite também em', 22),
    ),
    'og',
  );
}

// ---------------------------------------------------------------- placar, cidade, momento

/**
 * Card de divulgação (antes das 19h): o convite, não o placar. Título grande, os dois candidatos frente a frente
 * nas cores de cada lado e o que o site tem (placar, chat, palpite). É o que aparece ao colar o link no X/WhatsApp.
 */
export function teaserCard(cands: CandidateDef[]) {
  const [ca, cb] = cands;
  const side = (c: CandidateDef, align: 'left' | 'right') =>
    h(
      { flexDirection: 'column', alignItems: align === 'left' ? 'flex-start' : 'flex-end', gap: 14 },
      h(
        { borderRadius: 40, padding: 6, background: c.color },
        photo(c, 168, 34),
      ),
      h(
        { flexDirection: 'column', alignItems: align === 'left' ? 'flex-start' : 'flex-end', gap: 2 },
        h({ fontSize: 34, fontWeight: 800, letterSpacing: -0.8 }, c.short),
        h({ fontSize: 22, color: MUTED }, [c.n, c.party].filter(Boolean).join(' · ')),
      ),
    );
  return render(
    h(
      {
        width: 1200,
        height: 630,
        background: BG,
        // cada lado com um brilho da cor do seu candidato
        backgroundImage: `linear-gradient(90deg, ${ca.color}40 0%, ${ca.color}10 28%, transparent 46%, transparent 54%, ${cb.color}10 72%, ${cb.color}40 100%)`,
        color: FG,
        fontFamily: 'Inter',
        flexDirection: 'column',
        padding: '44px 64px 40px',
      },
      h(
        { justifyContent: 'space-between', alignItems: 'center' },
        h({ alignItems: 'center', gap: 16 }, h({ fontSize: 30, fontWeight: 800, letterSpacing: -1 }, 'urna.digi'), h({ fontSize: 18, color: MUTED, letterSpacing: 3 }, '2º TURNO')),
        h(
          { alignItems: 'center', gap: 10, fontSize: 20, fontWeight: 800, letterSpacing: 1.5, color: FG, border: `1px solid ${LINE}`, borderRadius: 999, padding: '8px 18px', background: CARD },
          dot('#22c55e', 12),
          'AO VIVO DOMINGO, 19H',
        ),
      ),
      h(
        { flexDirection: 'column', marginTop: 34 },
        h({ fontSize: 64, fontWeight: 800, letterSpacing: -2.4, lineHeight: 1.02 }, 'Apuração do 2º turno'),
        h({ fontSize: 64, fontWeight: 800, letterSpacing: -2.4, lineHeight: 1.02, color: MUTED }, 'com chat em tempo real'),
      ),
      h(
        { flexGrow: 1, alignItems: 'flex-end', justifyContent: 'space-between' },
        side(ca, 'left'),
        h(
          { flexDirection: 'column', alignItems: 'center', gap: 10, paddingBottom: 30 },
          h({ fontSize: 56, fontWeight: 800, color: MUTED }, '×'),
          h({ fontSize: 20, color: MUTED }, 'Dados oficiais do TSE'),
          h({ fontSize: 22, fontWeight: 800 }, host()),
        ),
        side(cb, 'right'),
      ),
    ),
    'og',
  );
}

export function scoreCard(o: { title: string; snap: Snap | null; cands: CandidateDef[]; subtitle?: string; at?: string | null }) {
  const [ca, cb] = o.cands;
  const s = o.snap && o.snap.valid > 0 ? o.snap : null;
  const fmtVotes = (n: number) => `${n.toLocaleString('pt-BR')} votos`;
  const rows = s
    ? h(
        { flexDirection: 'column', gap: 18, flexGrow: 1, justifyContent: 'center' },
        candRow(ca, s.pa, { lead: s.lead === 'a', dim: s.lead === 'b', photo: 92, name: 32, big: 68, votes: fmtVotes(s.a), digits: 2 }),
        candRow(cb, s.pb, { lead: s.lead === 'b', dim: s.lead === 'a', photo: 92, name: 32, big: 68, votes: fmtVotes(s.b), digits: 2 }),
        bar(s.pa, ca, cb, 14),
      )
    : h(
        { gap: 28, flexGrow: 1, alignItems: 'center' },
        h({}, photo(ca, 150, 34), h({ marginLeft: -26, display: 'flex' }, photo(cb, 150, 34))),
        h(
          { flexDirection: 'column', gap: 10, flexShrink: 1 },
          h({ fontSize: 30, fontWeight: 800 }, `${ca.short} × ${cb.short}`),
          h({ fontSize: 26, color: MUTED }, stripEmoji(o.subtitle ?? 'Placar ao vivo a partir das 19h (Brasília)')),
        ),
      );
  const status = s
    ? s.status === 'totalizado'
      ? 'Totalizado pelo TSE'
      : s.status === 'definido'
        ? `Matematicamente definido · ${fmtPct(s.pst, 1)}% apurado`
        : `${fmtPct(s.pst, 1)}% das urnas apuradas`
    : 'Presidente';
  const at = o.at ? `Dados oficiais do TSE · ${fmtBrt(o.at, { hour: '2-digit', minute: '2-digit' })}` : 'Dados oficiais do TSE';
  return render(
    h(
      { width: 1200, height: 630, background: BG, color: FG, fontFamily: 'Inter', flexDirection: 'column', padding: '48px 64px', gap: 22 },
      header('· 2º turno', status, 22),
      h(
        { flexDirection: 'column', gap: 6 },
        h({ fontSize: stripEmoji(o.title).length > 48 ? 38 : 46, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1.1 }, stripEmoji(o.title)),
        s && o.subtitle ? h({ fontSize: 24, color: MUTED }, stripEmoji(o.subtitle)) : null,
      ),
      rows,
      footer(at, 22),
    ),
    'og',
  );
}
