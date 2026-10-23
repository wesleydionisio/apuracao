// Índice de municípios para busca (acento-insensível) + cidades recentes no aparelho.
import type { Municipality } from '@apuracao/shared';
import { useEffect, useMemo, useState } from 'react';
import { staticData } from '@/lib/api';
import { normalizeText } from '@/lib/format';

export interface Indexed {
  m: Municipality;
  key: string;
}

let indexPromise: Promise<Indexed[]> | null = null;
export function loadCityIndex(): Promise<Indexed[]> {
  indexPromise ??= staticData
    .municipalities()
    .then((list) =>
      (list ?? [])
        .filter((m) => m.uf !== 'ZZ' && m.ibge)
        .map((m) => ({ m, key: normalizeText(m.name) }))
        .sort((a, b) => b.m.el - a.m.el),
    )
    .catch(() => {
      indexPromise = null;
      return [];
    });
  return indexPromise;
}

export function useCityIndex(enabled = true) {
  const [idx, setIdx] = useState<Indexed[] | null>(null);
  useEffect(() => {
    if (enabled && !idx) loadCityIndex().then(setIdx);
  }, [enabled, idx]);
  return idx;
}

/** prefixo primeiro, depois "contém"; empate pelo eleitorado. "sao paulo sp" filtra por UF. */
export function searchCities(idx: Indexed[] | null, q: string, limit = 20): Municipality[] {
  if (!idx) return [];
  let n = normalizeText(q);
  if (n.length < 2) return [];
  let uf: string | null = null;
  const m = /^(.*?)[\s,/-]+([a-z]{2})$/.exec(n);
  if (m && m[1].length >= 2) {
    n = m[1].trim();
    uf = m[2].toUpperCase();
  }
  const starts: Municipality[] = [];
  const contains: Municipality[] = [];
  for (const it of idx) {
    if (uf && it.m.uf !== uf) continue;
    if (it.key.startsWith(n)) starts.push(it.m);
    else if (contains.length < limit && it.key.includes(n)) contains.push(it.m);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

export function useCitySearch(q: string, enabled = true, limit = 20) {
  const idx = useCityIndex(enabled || q.length > 0);
  const results = useMemo(() => searchCities(idx, q, limit), [idx, q, limit]);
  return { idx, results };
}

// ---------------------------------------------------------------- recentes

const LS = 'recent-cities';
export type RecentCity = Pick<Municipality, 'ibge' | 'name' | 'uf' | 'slug'>;

export function readRecents(): RecentCity[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS) ?? '[]');
    return Array.isArray(v) ? v.slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function pushRecent(m: RecentCity) {
  try {
    const list = [{ ibge: m.ibge, name: m.name, uf: m.uf, slug: m.slug }, ...readRecents().filter((x) => x.ibge !== m.ibge)].slice(0, 6);
    localStorage.setItem(LS, JSON.stringify(list));
  } catch {
    /* sem storage */
  }
}
