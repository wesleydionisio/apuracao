// Cards PNG para compartilhar (Stories 1080×1350, OG 1200×630). satori → SVG → resvg → PNG.
// Cache em disco por chave de conteúdo: cada card é gerado uma vez por versão dos dados.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { fmtBrt, fmtPct, type CandidateDef, type Snap } from '@apuracao/shared';
import { config } from './config';

type Node = { type: string; props: Record<string, unknown> };
type Child = Node | string | null | false;
type Style = Record<string, string | number>;

const h = (style: Style, ...children: Child[]): Node => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children: children.filter(Boolean) },
});

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
export const stripEmoji = (s: string) => s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').trim();

const BG = '#0b0f17';
const FG = '#f4f6fb';
const MUTED = '#9aa3b5';

export type Format = 'og' | 'story';
const SIZE: Record<Format, [number, number]> = { og: [1200, 630], story: [1080, 1350] };

function frame(fmt: Format, body: Child[], footer: string): Node {
  const [w, hgt] = SIZE[fmt];
  const pad = fmt === 'story' ? 80 : 64;
  return h(
    { width: w, height: hgt, background: BG, color: FG, fontFamily: 'Inter', flexDirection: 'column', padding: pad, justifyContent: 'space-between' },
    h({ flexDirection: 'column', gap: fmt === 'story' ? 48 : 24, flexGrow: 1, justifyContent: fmt === 'story' ? 'center' : 'flex-start' }, ...body),
    h(
      { justifyContent: 'space-between', gap: 24, fontSize: fmt === 'story' ? 30 : 24, color: MUTED, borderTop: `2px solid #222a3a`, paddingTop: 24 },
      h({}, footer),
      h({}, new URL(config.publicUrl).host),
    ),
  );
}

function bar(pa: number, ca: CandidateDef, cb: CandidateDef, height: number): Node {
  return h(
    { width: '100%', height, borderRadius: height / 2, overflow: 'hidden', background: '#222a3a' },
    h({ width: `${Math.max(0, Math.min(100, pa))}%`, background: ca.color }),
    h({ flexGrow: 1, background: cb.color }),
  );
}

function scoreRows(fmt: Format, cands: CandidateDef[], pa: number, label: string): Child[] {
  const [ca, cb] = cands;
  const big = fmt === 'story' ? 120 : 92;
  const name = fmt === 'story' ? 44 : 36;
  const side = (c: CandidateDef, p: number, align: 'flex-start' | 'flex-end') =>
    h(
      { flexDirection: 'column', alignItems: align },
      h({ fontSize: name, color: c.color, fontWeight: 800 }, c.short),
      h({ fontSize: big, fontWeight: 800, letterSpacing: -2 }, `${fmtPct(p, 1)}%`),
    );
  return [
    h({ fontSize: fmt === 'story' ? 34 : 26, color: MUTED, textTransform: 'uppercase', letterSpacing: 2 }, label),
    h({ justifyContent: 'space-between', alignItems: 'flex-end' }, side(ca, pa, 'flex-start'), side(cb, 100 - pa, 'flex-end')),
    bar(pa, ca, cb, fmt === 'story' ? 36 : 28),
  ];
}

async function render(node: Node, fmt: Format): Promise<Buffer> {
  const [w, hgt] = SIZE[fmt];
  const svg = await satori(node as never, { width: w, height: hgt, fonts: loadFonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: w } }).render().asPng());
}

const cacheDir = () => path.join(config.varDir, 'og');

/** gera (ou devolve do disco) o PNG da chave; `build` só roda em cache miss */
export async function cached(kind: string, keyData: unknown, build: () => Promise<Buffer>): Promise<Buffer> {
  const key = createHash('sha1').update(JSON.stringify(keyData)).digest('hex').slice(0, 20);
  const file = path.join(cacheDir(), `${kind}-${key}.png`);
  if (existsSync(file)) return readFile(file);
  const png = await build();
  mkdirSync(cacheDir(), { recursive: true });
  await writeFile(file, png);
  return png;
}

/** "top 2% do Brasil" quando vale a pena mostrar; senão a posição */
export function rankLine(rank: number, total: number): string {
  const top = (rank / Math.max(1, total)) * 100;
  if (total >= 20 && top <= 50) return `top ${fmtPct(Math.max(0.01, top), top < 1 ? 2 : 0)}% do Brasil`;
  return `${rank.toLocaleString('pt-BR')}º de ${total.toLocaleString('pt-BR')} palpites`;
}

export function guessCard(
  fmt: Format,
  o: { nick: string; pa: number; cands: CandidateDef[]; result?: { pa: number; dist: number; rank: number; total: number } },
) {
  const body: Child[] = o.result
    ? [
        h({ fontSize: fmt === 'story' ? 52 : 40, fontWeight: 800 }, o.result.dist < 0.005 ? 'Na mosca!' : `Errei por ${fmtPct(o.result.dist)} pontos`),
        h({ fontSize: fmt === 'story' ? 40 : 30, color: MUTED }, `${rankLine(o.result.rank, o.result.total)} · ${o.nick}`),
        ...scoreRows(fmt, o.cands, o.pa, 'Meu palpite'),
        h({ fontSize: fmt === 'story' ? 34 : 26, color: MUTED }, `Resultado TSE: ${o.cands[0].short} ${fmtPct(o.result.pa)}%`),
      ]
    : [
        h({ fontSize: fmt === 'story' ? 52 : 40, fontWeight: 800 }, `Palpite de ${o.nick} para o 2º turno`),
        ...scoreRows(fmt, o.cands, o.pa, 'Meu palpite'),
        h({ fontSize: fmt === 'story' ? 38 : 28, color: MUTED }, 'Qual é o seu? Faça o seu palpite e acompanhe a apuração ao vivo.'),
      ];
  return render(frame(fmt, body, 'Palpite · não é pesquisa nem projeção'), fmt);
}

export function scoreCard(o: { title: string; snap: Snap | null; cands: CandidateDef[]; subtitle?: string; at?: string | null }) {
  const body: Child[] = [h({ fontSize: 46, fontWeight: 800 }, stripEmoji(o.title))];
  if (o.subtitle) body.push(h({ fontSize: 28, color: MUTED }, stripEmoji(o.subtitle)));
  if (o.snap && o.snap.valid > 0) body.push(...scoreRows('og', o.cands, o.snap.pa, `${fmtPct(o.snap.pst, 1)}% das urnas apuradas`));
  const footer = o.at ? `Dados oficiais do TSE · ${fmtBrt(o.at, { hour: '2-digit', minute: '2-digit' })}` : 'Dados oficiais do TSE';
  return render(frame('og', body, footer), 'og');
}
