// Fontes dos cards PNG (satori aceita ttf/otf/woff; woff2 não). Subconjunto latin cobre acentos do português.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, fetchBuf, FONTS, isMain, kb } from './lib';

const VERSION = '5.1.0';
const url = (w: number) => `https://cdn.jsdelivr.net/fontsource/fonts/inter@${VERSION}/latin-${w}-normal.woff`;

export async function buildFonts() {
  ensureDir(FONTS);
  for (const w of [400, 800]) {
    const dest = join(FONTS, `inter-${w}.woff`);
    if (existsSync(dest)) continue;
    const buf = await fetchBuf(url(w));
    if (!buf) throw new Error(`fonte ${w} não encontrada`);
    // woff começa com "wOFF"
    if (buf.subarray(0, 4).toString('latin1') !== 'wOFF') throw new Error(`fonte ${w}: não é woff`);
    writeFileSync(dest, buf);
    console.log(`inter-${w}.woff: ${kb(buf.length)}`);
  }
}

if (isMain(import.meta.url)) await buildFonts();
