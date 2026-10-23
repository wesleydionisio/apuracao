// Utilidades comuns do ETL: caminhos, download com cache/retry, pool de concorrência.
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../../..');
export const RAW = resolve(here, '../raw');
export const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(ROOT, 'public/data');
export const STATIC = join(DATA_DIR, 'static');
export const GEO = join(ROOT, 'apps/web/public/geo');
export const FONTS = join(ROOT, 'apps/api/assets/fonts');

export const UA = 'apuracao-viral-etl/0.1 (projeto independente; contato producao@aueh.com.br)';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ensureDir(p: string) {
  mkdirSync(p, { recursive: true });
}

export function writeJson(path: string, data: unknown) {
  ensureDir(dirname(path));
  const s = JSON.stringify(data);
  writeFileSync(path, s);
  return s.length;
}

export const readJson = <T = unknown>(path: string): T => JSON.parse(readFileSync(path, 'utf8'));

export function sizes(path: string) {
  const buf = readFileSync(path);
  return { raw: buf.length, gz: gzipSync(buf).length };
}

export const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

/** GET com retry/backoff exponencial + jitter. 404 → null (não tenta de novo). */
export async function fetchBuf(url: string, tries = 5): Promise<Buffer | null> {
  let wait = 1000;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-encoding': 'gzip' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (i === tries) throw new Error(`${url}: ${(e as Error).message}`);
      await sleep(wait + Math.random() * wait);
      wait *= 2;
    }
  }
  return null;
}

/** Baixa um JSON com cache em raw/<cacheName>. */
export async function cachedJson<T = unknown>(url: string, cacheName: string): Promise<T | null> {
  const p = join(RAW, cacheName);
  if (existsSync(p) && statSync(p).size > 0) return JSON.parse(readFileSync(p, 'utf8'));
  const buf = await fetchBuf(url);
  if (!buf) return null;
  ensureDir(dirname(p));
  writeFileSync(p, buf);
  return JSON.parse(buf.toString('utf8'));
}

/** Download grande em streaming para o cache (pula se já existir com o tamanho esperado). */
export async function download(url: string, dest: string) {
  const head = await fetch(url, { method: 'HEAD', headers: { 'user-agent': UA } });
  const len = Number(head.headers.get('content-length') ?? 0);
  if (existsSync(dest) && (!len || statSync(dest).size === len)) return dest;
  ensureDir(dirname(dest));
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
  return dest;
}

/** Executa `fn` sobre `items` com no máximo `n` em paralelo. */
export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
      if (++done % 500 === 0) console.log(`  … ${done}/${items.length}`);
    }
  });
  await Promise.all(workers);
  return out;
}

export function isMain(metaUrl: string) {
  return resolve(fileURLToPath(metaUrl)) === resolve(process.argv[1] ?? '');
}
