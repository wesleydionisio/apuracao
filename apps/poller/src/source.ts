// Fonte dos JSONs. TseSource: um único cliente HTTP educado (ETag, timeout, sem paralelismo agressivo).
// "Modo manual": se existir MANUAL_DIR/<caminho>, ele vence (para colar JSON na mão se o TSE mudar algo).
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config';

export interface Source {
  get(p: string): Promise<unknown | null>;
  readonly name: string;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
  ) {
    super(`HTTP ${status} ${url}`);
  }
}

export class TseSource implements Source {
  readonly name = 'tse';
  private etags = new Map<string, { etag: string; body: unknown }>();

  constructor(private cfg: Config) {}

  async get(p: string): Promise<unknown | null> {
    const manual = path.join(this.cfg.manualDir, p);
    if (existsSync(manual)) return JSON.parse(await readFile(manual, 'utf8'));

    const url = `${this.cfg.tse.base}/${p}`;
    const cached = this.etags.get(p);
    const res = await fetch(url, {
      headers: {
        'user-agent': this.cfg.tse.userAgent,
        accept: 'application/json',
        ...(cached ? { 'if-none-match': cached.etag } : {}),
      },
      signal: AbortSignal.timeout(this.cfg.tse.timeoutMs),
    });
    if (res.status === 304 && cached) return cached.body;
    if (res.status === 404 || res.status === 403) return null; // arquivo ainda não publicado
    if (!res.ok) throw new HttpError(res.status, url);
    const body = await res.json();
    const etag = res.headers.get('etag');
    if (etag) this.etags.set(p, { etag, body });
    return body;
  }
}

/** executa `fn` em `items` com no máximo `n` em paralelo */
export async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<(R | Error)[]> {
  const out: (R | Error)[] = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      try {
        out[k] = await fn(items[k]);
      } catch (e) {
        out[k] = e instanceof Error ? e : new Error(String(e));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
