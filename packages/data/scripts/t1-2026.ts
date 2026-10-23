// 1º turno 2026 (eleição 6257): BR, UFs e todos os municípios → hist/t1-2026*.json
import { join } from 'node:path';
import {
  parseResult,
  TSE_BASE,
  TSE_UFS,
  tsePaths,
  type HistoryFile,
  type HistRow,
  type Municipality,
  type ParsedResult,
} from '@apuracao/shared';
import { buildMunicipalities, MUN_FILE, T1 } from './municipalities';
import { cachedJson, isMain, pool, STATIC, writeJson } from './lib';

export const toHist = (p: ParsedResult): HistRow => ({
  el: p.el,
  turnout: p.turnout,
  abst: p.abst,
  valid: p.valid,
  blank: p.blank,
  nulls: p.nulls,
  votes: p.votes,
});

async function getResult(uf: string, mun?: string): Promise<ParsedResult | null> {
  const path = tsePaths.result(T1, uf, mun);
  const raw = await cachedJson(`${TSE_BASE}/${path}`, `tse/${path}`);
  return raw ? parseResult(raw) : null;
}

export async function buildT1() {
  const t0 = Date.now();
  const muns = await buildMunicipalities();

  const br = await getResult('br');
  if (!br) throw new Error('BR do 1º turno não encontrado');
  const uf: Record<string, HistRow> = {};
  await pool(TSE_UFS, 4, async (u) => {
    const r = await getResult(u);
    if (!r) throw new Error(`UF ${u} não encontrada`);
    uf[u.toUpperCase()] = toHist(r);
  });

  console.log(`baixando ${muns.length} municípios (concorrência 4, cache em raw/)…`);
  const byUf: Record<string, Record<string, HistRow>> = {};
  const missing: Municipality[] = [];
  await pool(muns, 4, async (m) => {
    const r = await getResult(m.uf.toLowerCase(), m.tse);
    if (!r) return void missing.push(m);
    (byUf[m.uf] ??= {})[m.ibge] = toHist(r);
    m.el = r.el;
  });
  if (missing.length) console.warn(`⚠ ${missing.length} municípios sem arquivo: ${missing.slice(0, 5).map((m) => `${m.uf}/${m.tse}`)}`);
  writeJson(MUN_FILE, muns);

  // validação: soma dos municípios = UF; soma das UFs = BR
  const problems: string[] = [];
  const keys: (keyof Omit<HistRow, 'votes'>)[] = ['el', 'turnout', 'valid', 'blank', 'nulls'];
  for (const [u, rows] of Object.entries(byUf)) {
    for (const k of keys) {
      const sum = Object.values(rows).reduce((s, r) => s + r[k], 0);
      if (sum !== uf[u][k]) problems.push(`${u}.${k}: municípios ${sum} ≠ UF ${uf[u][k]}`);
    }
  }
  for (const k of keys) {
    const sum = Object.values(uf).reduce((s, r) => s + r[k], 0);
    if (sum !== br[k]) problems.push(`BR.${k}: UFs ${sum} ≠ BR ${br[k]}`);
  }
  console.log(problems.length ? `⚠ divergências:\n  ${problems.join('\n  ')}` : '✔ municípios = UF = BR em el/turnout/valid/blank/nulls');

  const file: HistoryFile = { label: '1º turno 2026', year: 2026, round: 1, br: toHist(br), uf, mun: {} };
  writeJson(join(STATIC, 'hist/t1-2026.json'), file);
  for (const [u, rows] of Object.entries(byUf)) writeJson(join(STATIC, `hist/t1-2026/${u}.json`), rows);
  console.log(`t1-2026: ${Object.keys(uf).length} UFs, ${muns.length - missing.length} municípios em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return { problems, missing };
}

if (isMain(import.meta.url)) await buildT1();
