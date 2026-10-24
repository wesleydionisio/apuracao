import type { Board, Guess, HistoryFile, HistRow, MunBoard, Municipality, ScCharge, Snap } from '@apuracao/shared';
import { DEFAULT_RELEASE_AT, hueOf, randomNick, slugify } from '@apuracao/shared';
import { MOCK, MOCK_PRE } from './env';

export interface Me {
  id: string;
  nick: string;
  hue: number;
  /** lado da torcida no chat */
  side?: 'a' | 'b' | null;
  /** entrou com o Google (só assim manda mensagem); o apelido é o nome de usuário */
  auth?: boolean;
}

export interface Stats {
  online: number;
  guesses: number;
  /** palpites novos na última hora */
  guessesLastHour?: number;
  /** % dos palpites que dão a vitória ao candidato A */
  guessAWins?: number | null;
  /** últimos palpites (o "fulano palpitou agora") */
  recentGuesses?: { nick: string; pa: number; at: string }[];
  topCities: { ibge: string; name: string; uf: string; n: number }[];
}

export interface GuessLive {
  pa: number;
  dist: number;
  rank: number;
  total: number;
  ufRank?: number;
  ufTotal?: number;
  munRank?: number;
  munTotal?: number;
}

export interface GuessView {
  guess: Guess;
  live: GuessLive | null;
  final: boolean;
}

export interface GuessInput {
  nick: string;
  pa: number;
  uf?: string | null;
  ufPa?: number | null;
  mun?: string | null;
  munPa?: number | null;
}

export interface CityView {
  mun: Municipality;
  now: Snap | null;
  t1: HistRow | null;
  y2022: HistRow | null;
  uf: Snap | null;
  br: Snap | null;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code?: string,
  ) {
    super(`HTTP ${status}${code ? ` ${code}` : ''}`);
  }
}

/** Em modo mock, o placar (/data/br.json, /data/mun/*) vem de /dev-fixtures; o histórico é o real. */
const dataUrl = (path: string) => (MOCK ? path.replace(/^\/data\/(br\.json|mun\/)/, '/dev-fixtures/$1') : path);

export async function getJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(dataUrl(path), { credentials: 'same-origin', ...init });
  if (!r.ok) {
    let code: string | undefined;
    try {
      code = (await r.json())?.error;
    } catch {
      /* corpo não-JSON */
    }
    throw new HttpError(r.status, code);
  }
  const ct = r.headers.get('content-type') ?? '';
  // o fallback do SPA devolve index.html para arquivos inexistentes: trate como 404
  if (!ct.includes('json')) throw new HttpError(404);
  return r.json() as Promise<T>;
}

/** Igual a getJSON, mas devolve null em 404 (arquivo estático ainda não gerado). */
export async function getOptional<T>(path: string): Promise<T | null> {
  try {
    return await getJSON<T>(path);
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 403)) return null;
    throw e;
  }
}

// cache simples em memória para arquivos estáticos grandes
const memo = new Map<string, Promise<unknown>>();
export function cached<T>(path: string): Promise<T | null> {
  if (!memo.has(path)) {
    const p = getOptional<T>(path).catch((e) => {
      memo.delete(path);
      throw e;
    });
    memo.set(path, p);
  }
  return memo.get(path) as Promise<T | null>;
}

export const staticData = {
  municipalities: () => cached<Municipality[]>('/data/static/municipalities.json'),
  hist: (id: 't1-2026' | 'y2022-t1' | 'y2022-t2') => cached<HistoryFile>(`/data/static/hist/${id}.json`),
  histMun: (id: 't1-2026' | 'y2022-t1' | 'y2022-t2', uf: string) =>
    cached<Record<string, HistRow>>(`/data/static/hist/${id}/${uf}.json`),
  curve2022: () =>
    cached<{ label: string; note: string; points: { pst: number; pct: Record<string, number> }[] }>(
      '/data/static/curve-2022.json',
    ),
};

export async function fetchBoard(): Promise<Board> {
  const b = await getJSON<Board>('/data/br.json', { cache: 'no-cache' });
  if (MOCK_PRE) return { ...b, released: false, releaseAt: DEFAULT_RELEASE_AT, br: null, ufs: {}, remaining: [], projection: null, curve: [], moments: [] };
  return b;
}

export const fetchMunBoard = (uf: string) => getOptional<MunBoard>(`/data/mun/${uf}.json`);

// ---------------------------------------------------------------- API real

const post = <T,>(path: string, body: unknown) =>
  getJSON<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const real = {
  me: () => getJSON<Me>('/api/me'),
  stats: () => getJSON<Stats>('/api/stats'),
  postGuess: (g: GuessInput) => post<{ guess: Guess; url: string }>('/api/guess', g),
  guess: (id: string) => getJSON<GuessView>(`/api/guess/${encodeURIComponent(id)}`),
  cityBySlug: (uf: string, slug: string) =>
    getJSON<CityView>(`/api/city/by-slug/${encodeURIComponent(uf)}/${encodeURIComponent(slug)}`),
};

/** Super Chat: gerar o Pix, acompanhar o pagamento e (só em dev) simular */
export const superchatApi = {
  create: (b: { room: string; body: string; amount: number; side: 'a' | 'b' | null }) => post<ScCharge>('/api/superchat', b),
  get: (id: string) => getJSON<ScCharge>(`/api/superchat/${encodeURIComponent(id)}`, { cache: 'no-store' }),
  devPay: (id: string) => post<ScCharge>(`/api/superchat/${encodeURIComponent(id)}/dev-pay`, {}),
};

// ---------------------------------------------------------------- mock (dev)

const LS_GUESSES = 'mock:guesses';
function mockGuesses(): Record<string, Guess> {
  try {
    return JSON.parse(localStorage.getItem(LS_GUESSES) ?? '{}');
  } catch {
    return {};
  }
}

const mock: typeof real = {
  async me() {
    let id = sessionStorage.getItem('mock:aid');
    if (!id) {
      id = Math.random().toString(36).slice(2);
      sessionStorage.setItem('mock:aid', id);
    }
    return { id, nick: randomNick(), hue: hueOf(id) };
  },
  async stats() {
    const m = (await staticData.municipalities()) ?? [];
    return {
      online: 48211 + Math.floor(Math.random() * 300),
      guesses: 131977 + Math.floor((Date.now() / 1000) % 600),
      guessesLastHour: 8412,
      guessAWins: 53.4,
      recentGuesses: ['ana_sp', 'Joca', 'mari.bh', 'pedrinho', 'Tia Lu', 'zeca22'].map((nick, i) => ({
        nick,
        pa: Math.round((46 + Math.random() * 8) * 10) / 10,
        at: new Date(Date.now() - i * 9000).toISOString(),
      })),
      topCities: [...m].sort((x, y) => y.el - x.el).slice(0, 5).map((x, i) => ({ ibge: x.ibge, name: x.name, uf: x.uf, n: 9000 - i * 1300 })),
    };
  },
  async postGuess(g) {
    const all = mockGuesses();
    const id = Math.random().toString(36).slice(2, 9);
    const guess: Guess = {
      id,
      nick: g.nick,
      pa: g.pa,
      uf: g.uf ?? null,
      ufPa: g.ufPa ?? null,
      mun: g.mun ?? null,
      munPa: g.munPa ?? null,
      createdAt: new Date().toISOString(),
    };
    all[id] = guess;
    localStorage.setItem(LS_GUESSES, JSON.stringify(all));
    return { guess, url: `/p/${id}` };
  },
  async guess(id) {
    const guess = mockGuesses()[id];
    if (!guess) throw new HttpError(404, 'not_found');
    const b = await fetchBoard();
    if (!b.br) return { guess, live: null, final: false };
    const dist = Math.abs(guess.pa - b.br.pa);
    const total = 131977;
    return {
      guess,
      live: { pa: b.br.pa, dist, rank: Math.max(1, Math.round(dist * 9000)), total, ufRank: 120, ufTotal: 8211 },
      final: b.br.status === 'totalizado',
    };
  },
  async cityBySlug(uf, slug) {
    const list = (await staticData.municipalities()) ?? [];
    const mun = list.find((m) => m.uf === uf.toUpperCase() && (m.slug === slug || slugify(m.name) === slug));
    if (!mun) throw new HttpError(404, 'not_found');
    const [b, mb, t1, y22] = await Promise.all([
      fetchBoard(),
      fetchMunBoard(mun.uf),
      staticData.histMun('t1-2026', mun.uf),
      staticData.histMun('y2022-t2', mun.uf),
    ]);
    return {
      mun,
      now: mb?.mun[mun.ibge] ?? null,
      t1: t1?.[mun.ibge] ?? null,
      y2022: y22?.[mun.ibge] ?? null,
      uf: b.ufs[`uf:${mun.uf}`] ?? null,
      br: b.br,
    };
  },
};

export const api = MOCK ? mock : real;

export const ogUrl = {
  guess: (id: string, f: 'story' | 'og' = 'story') => `/api/og/guess/${id}.png?f=${f}`,
  city: (ibge: string) => `/api/og/city/${ibge}.png`,
  moment: (id: string) => `/api/og/moment/${encodeURIComponent(id)}.png`,
  board: () => `/api/og/board.png`,
};
