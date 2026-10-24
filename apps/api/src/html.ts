// index.html do SPA com <meta> OG por rota (preview bonito no WhatsApp).
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { config } from './config';

let tpl: { file: string; mtime: number; html: string } | null = null;

function template(): string {
  const dist = path.join(config.webDist, 'index.html');
  const file = existsSync(dist) ? dist : path.join(config.repo, 'apps/web/index.html');
  const mtime = existsSync(file) ? statSync(file).mtimeMs : 0;
  if (!tpl || tpl.file !== file || tpl.mtime !== mtime) {
    const html = existsSync(file) ? readFileSync(file, 'utf8') : '<!doctype html><html><head><!--OG--></head><body></body></html>';
    // as metas padrão do template (bloco <!--OG-->…<!--/OG-->) saem: quem manda é a rota
    const clean = html
      .replace(/<!--OG-->[\s\S]*?<!--\/OG-->/, '<!--OG-->')
      .replace(/<meta\s+(property|name)="(og:|twitter:)[^"]*"[^>]*>\s*/g, '')
      .replace(/<meta\s+name="description"[^>]*>\s*/g, '')
      .replace(/<link\s+rel="canonical"[^>]*>\s*/g, '');
    tpl = { file, mtime, html: clean.includes('<!--OG-->') ? clean : clean.replace('</head>', '<!--OG--></head>') };
  }
  return tpl.html;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface Meta {
  title: string;
  description: string;
  path: string;
  /** caminho absoluto da imagem (ex.: /api/og/board.png) */
  image: string;
  imageW?: number;
  imageH?: number;
  /** fora dos buscadores (TV, embed): continua com prévia nas redes */
  noindex?: boolean;
  /** dados estruturados (JSON-LD) */
  jsonLd?: object;
}

export function renderHtml(m: Meta): string {
  const url = `${config.publicUrl}${m.path}`;
  const img = `${config.publicUrl}${m.image}`;
  const tags = [
    `<meta name="description" content="${esc(m.description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(config.siteName)}">`,
    `<meta property="og:title" content="${esc(m.title)}">`,
    `<meta property="og:description" content="${esc(m.description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta property="og:image:width" content="${m.imageW ?? 1200}">`,
    `<meta property="og:image:height" content="${m.imageH ?? 630}">`,
    `<meta property="og:locale" content="pt_BR">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(m.title)}">`,
    `<meta name="twitter:description" content="${esc(m.description)}">`,
    `<meta name="twitter:image" content="${esc(img)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    ...(m.noindex ? ['<meta name="robots" content="noindex">'] : []),
    // "<" escapado: o JSON não fecha o <script> por acidente
    ...(m.jsonLd ? [`<script type="application/ld+json">${JSON.stringify(m.jsonLd).replace(/</g, '\\u003c')}</script>`] : []),
  ].join('\n    ');
  return template()
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(m.title)}</title>`)
    .replace('<!--OG-->', tags);
}
