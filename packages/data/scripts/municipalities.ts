// municipalities.json: lista completa (incl. exterior) com de-para TSE↔IBGE.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseMunicipalities, slugify, titleCase, TSE_BASE, tsePaths, type Municipality } from '@apuracao/shared';
import { cachedJson, isMain, readJson, STATIC, writeJson } from './lib';

export const T2 = { cycle: 'ele2026', code: '6258' };
export const T1 = { cycle: 'ele2026', code: '6257' };
export const MUN_FILE = join(STATIC, 'municipalities.json');

export async function buildMunicipalities(): Promise<Municipality[]> {
  const raw = await cachedJson(`${TSE_BASE}/${tsePaths.municipalities(T2)}`, 'tse/mun-e006258-cm.json');
  if (!raw) throw new Error('config de municípios do 2º turno não encontrada');
  const prev = new Map<string, number>();
  if (existsSync(MUN_FILE)) for (const m of readJson<Municipality[]>(MUN_FILE)) prev.set(m.tse, m.el);

  const list: Municipality[] = parseMunicipalities(raw).map((m) => {
    const name = titleCase(m.name);
    return {
      ibge: m.ibge || `zz${m.tse}`,
      tse: m.tse,
      name,
      uf: m.uf,
      slug: slugify(name),
      el: prev.get(m.tse) ?? 0,
    };
  });

  // slugs únicos dentro da UF (a URL é /cidade/:uf/:slug)
  const seen = new Map<string, number>();
  for (const m of list) {
    const k = `${m.uf}/${m.slug}`;
    const n = seen.get(k) ?? 0;
    if (n) m.slug = `${m.slug}-${m.tse}`;
    seen.set(k, n + 1);
  }

  const noIbge = list.filter((m) => m.uf !== 'ZZ' && !/^\d{7}$/.test(m.ibge));
  if (noIbge.length) throw new Error(`${noIbge.length} municípios sem código IBGE: ${noIbge.slice(0, 5).map((m) => m.name)}`);
  writeJson(MUN_FILE, list);
  console.log(`municipalities.json: ${list.length} (${list.filter((m) => m.uf === 'ZZ').length} no exterior), IBGE 100%`);
  return list;
}

if (isMain(import.meta.url)) await buildMunicipalities();
