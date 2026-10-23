import type { Municipality } from '@apuracao/shared';
import { useEffect, useMemo, useState } from 'react';
import { staticData } from '../lib/api';
import { normalizeText } from '../lib/format';

interface Indexed {
  m: Municipality;
  key: string;
}

let indexPromise: Promise<Indexed[]> | null = null;
function loadIndex() {
  indexPromise ??= staticData
    .municipalities()
    .then((list) => (list ?? []).filter((m) => m.uf !== 'ZZ').map((m) => ({ m, key: normalizeText(m.name) })))
    .catch(() => {
      indexPromise = null;
      return [];
    });
  return indexPromise;
}

export function CitySearch({
  onPick,
  placeholder = 'Digite o nome da sua cidade',
  compact = false,
  autoFocus = false,
}: {
  onPick: (m: Municipality) => void;
  placeholder?: string;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState<Indexed[] | null>(null);
  useEffect(() => {
    if (!idx && (q || autoFocus)) loadIndex().then(setIdx);
  }, [q, idx, autoFocus]);

  const results = useMemo(() => {
    const n = normalizeText(q);
    if (!idx || n.length < 2) return [];
    const starts: Indexed[] = [];
    const contains: Indexed[] = [];
    for (const it of idx) {
      if (it.key.startsWith(n)) starts.push(it);
      else if (it.key.includes(n)) contains.push(it);
    }
    const byEl = (a: Indexed, b: Indexed) => b.m.el - a.m.el;
    return [...starts.sort(byEl), ...contains.sort(byEl)].slice(0, compact ? 5 : 8);
  }, [q, idx, compact]);

  return (
    <div>
      <input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="h-12 w-full rounded-xl border border-line bg-card px-4"
        aria-label="Buscar município"
      />
      {q.length >= 2 && (
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
          {!idx ? (
            <li className="px-4 py-3 text-[13px] text-muted">Carregando cidades…</li>
          ) : !results.length ? (
            <li className="px-4 py-3 text-[13px] text-muted">Nenhuma cidade encontrada</li>
          ) : (
            results.map(({ m }) => (
              <li key={m.ibge}>
                <button type="button" onClick={() => { onPick(m); setQ(''); }} className="flex min-h-12 w-full items-center justify-between px-4 text-left">
                  <span className="text-[15px]">{m.name}</span>
                  <span className="text-[13px] text-muted">{m.uf}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
