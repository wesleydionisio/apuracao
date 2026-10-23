// Palpites: índice em memória (histogramas de 0,01 ponto → ranking O(1)) + persistência.
// Com DATABASE_URL: Postgres é a fonte da verdade e cada worker sincroniza o índice a cada 15s.
// Sem: arquivo NDJSON em var/ (dev ou pane de banco).
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import type { Guess } from '@apuracao/shared';

export interface StoredGuess extends Guess {
  anonId: string;
  ipHash: string;
  updatedAt: string;
}

const BUCKETS = 10001; // 0,00 … 100,00
const bucket = (pa: number) => Math.max(0, Math.min(BUCKETS - 1, Math.round(pa * 100)));

class Hist {
  counts = new Int32Array(BUCKETS);
  total = 0;
  add(pa: number, d: 1 | -1) {
    this.counts[bucket(pa)] += d;
    this.total += d;
  }
  /** 1 + quantos estão estritamente mais perto do resultado do que `dist` */
  rank(result: number, dist: number): number {
    const c = bucket(result);
    const r = Math.round(dist * 100);
    let better = 0;
    for (let k = Math.max(0, c - r + 1); k <= Math.min(BUCKETS - 1, c + r - 1); k++) better += this.counts[k];
    return better + 1;
  }
}

export const newId = () => randomBytes(6).toString('base64url'); // 8 chars

export class GuessIndex {
  byId = new Map<string, StoredGuess>();
  byAnon = new Map<string, string>();
  national = new Hist();
  uf = new Map<string, Hist>();
  mun = new Map<string, Hist>();
  /** palpites por município (qualquer palpite que informou a cidade) — ranking de engajamento */
  munCount = new Map<string, number>();

  upsert(g: StoredGuess) {
    const old = this.byId.get(g.id);
    if (old) this.apply(old, -1);
    this.byId.set(g.id, g);
    this.byAnon.set(g.anonId, g.id);
    this.apply(g, 1);
  }

  private apply(g: StoredGuess, d: 1 | -1) {
    this.national.add(g.pa, d);
    if (g.uf && g.ufPa !== null) this.histOf(this.uf, g.uf).add(g.ufPa, d);
    if (g.mun) {
      this.munCount.set(g.mun, (this.munCount.get(g.mun) ?? 0) + d);
      if (g.munPa !== null) this.histOf(this.mun, g.mun).add(g.munPa, d);
    }
  }

  private histOf(m: Map<string, Hist>, k: string) {
    let h = m.get(k);
    if (!h) m.set(k, (h = new Hist()));
    return h;
  }

  topCities(n = 10) {
    return [...this.munCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  }
}

export interface GuessStore {
  index: GuessIndex;
  init(): Promise<void>;
  save(g: StoredGuess): Promise<void>;
  close(): Promise<void>;
}

export class FileStore implements GuessStore {
  index = new GuessIndex();
  private file: string;
  constructor(varDir: string) {
    this.file = path.join(varDir, 'guesses.ndjson');
  }
  async init() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    if (!existsSync(this.file)) return;
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (line.trim()) this.index.upsert(JSON.parse(line));
    }
  }
  async save(g: StoredGuess) {
    this.index.upsert(g);
    appendFileSync(this.file, JSON.stringify(g) + '\n'); // última linha de um id vence no replay
  }
  async close() {}
}

export class PgStore implements GuessStore {
  index = new GuessIndex();
  private pool: pg.Pool;
  private since = new Date(0);
  private timer?: NodeJS.Timeout;

  constructor(
    url: string,
    private schemaFile: string,
  ) {
    this.pool = new pg.Pool({ connectionString: url, max: 10 });
  }

  async init() {
    await this.pool.query(readFileSync(this.schemaFile, 'utf8'));
    await this.sync();
    this.timer = setInterval(() => this.sync().catch((e) => console.warn('[pg] sync', e.message)), 15_000);
  }

  private async sync() {
    const { rows } = await this.pool.query(
      `select id, nick, anon_id, pct_a, uf, uf_pct_a, mun_ibge, mun_pct_a, created_at, updated_at
         from guesses where updated_at > $1 order by updated_at`,
      [this.since],
    );
    for (const r of rows) {
      this.index.upsert({
        id: r.id, nick: r.nick, anonId: r.anon_id, pa: Number(r.pct_a), uf: r.uf,
        ufPa: r.uf_pct_a === null ? null : Number(r.uf_pct_a), mun: r.mun_ibge,
        munPa: r.mun_pct_a === null ? null : Number(r.mun_pct_a),
        createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(), ipHash: '',
      });
      this.since = r.updated_at;
    }
  }

  async save(g: StoredGuess) {
    await this.pool.query(
      `insert into guesses (id, nick, anon_id, pct_a, uf, uf_pct_a, mun_ibge, mun_pct_a, created_at, updated_at, ip_hash)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (anon_id) do update set nick = excluded.nick, pct_a = excluded.pct_a, uf = excluded.uf,
         uf_pct_a = excluded.uf_pct_a, mun_ibge = excluded.mun_ibge, mun_pct_a = excluded.mun_pct_a,
         updated_at = excluded.updated_at`,
      [g.id, g.nick, g.anonId, g.pa, g.uf, g.ufPa, g.mun, g.munPa, g.createdAt, g.updatedAt, g.ipHash],
    );
    this.index.upsert(g);
  }

  async close() {
    clearInterval(this.timer);
    await this.pool.end();
  }
}
