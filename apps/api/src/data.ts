// Leitura dos JSONs gerados pelo poller/ETL com cache por mtime (barato sob carga).
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Board, HistRow, Municipality, MunBoard } from '@apuracao/shared';
import { config } from './config';

const cache = new Map<string, { mtime: number; checked: number; value: unknown }>();

/** relê do disco no máximo a cada `ttl` ms, e só se o mtime mudou */
export function readCached<T>(file: string, ttl = 2000): T | null {
  const now = Date.now();
  const hit = cache.get(file);
  if (hit && now - hit.checked < ttl) return hit.value as T | null;
  if (!existsSync(file)) {
    cache.set(file, { mtime: 0, checked: now, value: null });
    return null;
  }
  const mtime = statSync(file).mtimeMs;
  if (hit && hit.mtime === mtime) {
    hit.checked = now;
    return hit.value as T;
  }
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as T;
    cache.set(file, { mtime, checked: now, value });
    return value;
  } catch {
    // arquivo no meio de uma escrita: devolve a versão anterior
    return (hit?.value as T) ?? null;
  }
}

export const board = () => readCached<Board>(path.join(config.dataDir, 'br.json'));
export const munBoard = (uf: string) => readCached<MunBoard>(path.join(config.dataDir, 'mun', `${uf}.json`));
export const histMun = (id: string, uf: string) =>
  readCached<Record<string, HistRow>>(path.join(config.staticDir, 'hist', id, `${uf}.json`), 60_000);

let munIndex: { list: Municipality[]; byIbge: Map<string, Municipality>; bySlug: Map<string, Municipality> } | null = null;

export function municipalities() {
  const list = readCached<Municipality[]>(path.join(config.staticDir, 'municipalities.json'), 60_000) ?? [];
  if (!munIndex || munIndex.list !== list) {
    munIndex = {
      list,
      byIbge: new Map(list.map((m) => [m.ibge, m])),
      bySlug: new Map(list.map((m) => [`${m.uf.toLowerCase()}/${m.slug}`, m])),
    };
  }
  return munIndex;
}

export function cityPayload(m: Municipality) {
  const b = board();
  const released = !!b?.released;
  return {
    mun: m,
    now: released ? (munBoard(m.uf)?.mun[m.ibge] ?? null) : null,
    t1: histMun('t1-2026', m.uf)?.[m.ibge] ?? null,
    y2022: histMun('y2022-t2', m.uf)?.[m.ibge] ?? null,
    uf: released ? (b?.ufs[`uf:${m.uf}`] ?? null) : null,
    br: released ? (b?.br ?? null) : null,
  };
}
