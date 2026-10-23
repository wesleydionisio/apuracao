// Carrega os arquivos estáticos do ETL (todos opcionais: sem eles o placar funciona, só perde contexto).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { HistoryFile, HistRow, Municipality } from '@apuracao/shared';

export interface History {
  municipalities: Municipality[];
  /** chave `${UF}:${códigoTSE}` */
  byTse: Map<string, Municipality>;
  byIbge: Map<string, Municipality>;
  t1: HistoryFile | null;
  /** 1º turno 2026 por município (IBGE) */
  t1Mun: Record<string, HistRow>;
  /** 2º turno 2022 por município (IBGE) */
  y22t2Mun: Record<string, HistRow>;
}

export function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch (e) {
    console.warn(`[history] ignorando ${file}: ${(e as Error).message}`);
    return null;
  }
}

/** junta hist/<id>/<UF>.json num só mapa por IBGE */
function readMunDir(dir: string): Record<string, HistRow> {
  const out: Record<string, HistRow> = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.json')) Object.assign(out, readJson<Record<string, HistRow>>(path.join(dir, f)) ?? {});
  }
  return out;
}

export function loadHistory(st: string): History {
  const municipalities = readJson<Municipality[]>(path.join(st, 'municipalities.json')) ?? [];
  const h: History = {
    municipalities,
    byTse: new Map(municipalities.map((m) => [`${m.uf}:${m.tse}`, m])),
    byIbge: new Map(municipalities.map((m) => [m.ibge, m])),
    t1: readJson<HistoryFile>(path.join(st, 'hist/t1-2026.json')),
    t1Mun: readMunDir(path.join(st, 'hist/t1-2026')),
    y22t2Mun: readMunDir(path.join(st, 'hist/y2022-t2')),
  };
  console.log(
    `[history] municípios=${municipalities.length} t1=${h.t1 ? 'ok' : '—'} t1Mun=${Object.keys(h.t1Mun).length} y22Mun=${Object.keys(h.y22t2Mun).length}`,
  );
  return h;
}
