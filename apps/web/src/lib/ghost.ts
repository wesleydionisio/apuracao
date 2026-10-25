// Placar "fantasma": um Board de mentira para desenhar o markup real enquanto o de verdade não chega.
// Dentro de `.ghost` (index.css) texto, cores e fotos viram blocos cinza; como os nós são os mesmos, quando o
// dado chega nada muda de altura nem de lugar — só a cor aparece e os números rolam até o valor certo.
import type { Board, CandidateDef, Snap } from '@apuracao/shared';
import { DEFAULT_RELEASE_AT } from '@apuracao/shared';

const KEY = 'last-released';

/** a última tela vista era "antes das 19h" ou placar? (decide qual fantasma desenhar; sem histórico, pelo relógio) */
export function lastReleased(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === '1' || v === '0') return v === '1';
  } catch {
    /* sem storage */
  }
  return Date.now() >= Date.parse(DEFAULT_RELEASE_AT);
}

export function rememberReleased(released: boolean) {
  try {
    localStorage.setItem(KEY, released ? '1' : '0');
  } catch {
    /* sem storage */
  }
}

const cand = (key: 'a' | 'b', n: string): CandidateDef => ({ key, n, name: 'Candidato', short: 'Candidato', color: 'var(--muted)', party: 'Partido' });

const snap: Snap = {
  s: 'br',
  at: new Date(0).toISOString(),
  pst: 50,
  a: 30_000_000,
  b: 30_000_000,
  pa: 50,
  pb: 50,
  valid: 60_000_000,
  blank: 0,
  nulls: 0,
  el: 0,
  elc: 0,
  turnout: 0,
  status: 'apurando',
  lead: null,
  need: null,
  rem: 0,
  rmax: 0,
};

let cached: Board | null = null;

export function ghostBoard(): Board {
  if (cached) return cached;
  const released = lastReleased();
  const now = new Date().toISOString();
  cached = {
    v: 0,
    generatedAt: now,
    released,
    releaseAt: DEFAULT_RELEASE_AT,
    source: { name: 'TSE', url: '', at: now },
    candidates: [cand('a', '00'), cand('b', '00')],
    y2022Map: { a: '00', b: '00' },
    flags: { chat: true, projection: false, map_mun: false },
    br: released ? snap : null,
    ufs: {},
    remaining: [],
    projection: null,
    curve: [],
    moments: released ? [{ id: 'ghost', kind: 'milestone', scope: 'br', title: 'Carregando os marcos da apuração', at: now }] : [],
  };
  return cached;
}

/** o placar é o fantasma? (hooks que buscam dados derivados do placar esperam o de verdade) */
export const isGhost = (b: Board | null | undefined) => !!b && b === cached;
