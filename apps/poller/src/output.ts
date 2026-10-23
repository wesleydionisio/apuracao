// Saídas do poller: JSON estático (sempre), Redis (se houver), Postgres (se houver).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CH, KEY, type Board, type Flags, type Moment, type MunBoard, type Snap } from '@apuracao/shared';
import { Redis } from 'ioredis';
import pg from 'pg';
import type { Config } from './config';
import type { PollState } from './board';

export async function writeJsonAtomic(file: string, data: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data));
  for (let i = 0; ; i++) {
    try {
      await rename(tmp, file);
      return;
    } catch (e) {
      // Windows: leitor com o arquivo aberto → EPERM momentâneo
      if (i >= 5) throw e;
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
}

export const hashOf = (x: unknown) => createHash('sha1').update(JSON.stringify(x)).digest('hex');

export class Output {
  private redis: Redis | null = null;
  private pool: pg.Pool | null = null;
  private lastMunHash = new Map<string, string>();

  constructor(private cfg: Config) {}

  async init() {
    if (this.cfg.redisUrl) {
      this.redis = new Redis(this.cfg.redisUrl, { maxRetriesPerRequest: 2, enableOfflineQueue: false });
      this.redis.on('error', (e) => console.warn('[redis]', e.message));
    }
    if (this.cfg.databaseUrl) {
      this.pool = new pg.Pool({ connectionString: this.cfg.databaseUrl, max: 3 });
      const schema = readFileSync(path.join(this.cfg.repo, 'infra/schema.sql'), 'utf8');
      await this.pool.query(schema);
    }
  }

  async flags(): Promise<Flags> {
    const def: Flags = { chat: true, projection: true, map_mun: true };
    if (!this.redis) return def;
    try {
      const [c, p, m] = await this.redis.mget(KEY.flag('chat'), KEY.flag('projection'), KEY.flag('map_mun'));
      return { chat: c !== '0', projection: p !== '0', map_mun: m !== '0' };
    } catch {
      return def;
    }
  }

  async writeBoard(board: Board) {
    await writeJsonAtomic(path.join(this.cfg.dataDir, 'br.json'), board);
  }

  async writeMun(st: PollState, ufOf: (ibge: string) => string | undefined) {
    const byUf: Record<string, Record<string, Snap>> = {};
    for (const [key, s] of Object.entries(st.mun)) {
      const ibge = key.slice(4);
      const uf = ufOf(ibge);
      if (uf) (byUf[uf] ??= {})[ibge] = s;
    }
    for (const [uf, mun] of Object.entries(byUf)) {
      const h = hashOf(mun);
      if (this.lastMunHash.get(uf) === h) continue;
      const doc: MunBoard = { generatedAt: new Date().toISOString(), uf, mun };
      await writeJsonAtomic(path.join(this.cfg.dataDir, 'mun', `${uf}.json`), doc);
      this.lastMunHash.set(uf, h);
    }
  }

  /** publica só depois da liberação; antes disso nada sai para cliente nenhum */
  async publish(changed: Snap[], moments: Moment[]) {
    if (this.redis && changed.length) {
      try {
        const m = this.redis.multi();
        for (const s of changed) m.set(KEY.snap(s.s), JSON.stringify(s));
        m.publish(CH.snap, JSON.stringify(changed));
        for (const mo of moments) m.publish(CH.moment, JSON.stringify(mo));
        await m.exec();
      } catch (e) {
        console.warn('[redis] publish falhou:', (e as Error).message);
      }
    }
  }

  async persist(changed: Snap[], moments: Moment[], raw: Map<string, unknown>) {
    if (!this.pool || (!changed.length && !moments.length)) return;
    try {
      for (const s of changed) {
        const [scope, code = 'br'] = s.s.split(':');
        await this.pool.query(
          `insert into snapshots(scope, scope_code, captured_at, pct_counted, votes_a, votes_b, blank, nulls, abst, raw)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [scope, code, s.at, s.pst, s.a, s.b, s.blank, s.nulls, Math.max(0, s.elc - s.turnout), raw.get(s.s) ?? null],
        );
      }
      for (const m of moments) {
        const [scope, code = 'br'] = m.scope.split(':');
        await this.pool.query(
          `insert into moments(id, kind, scope, scope_code, title, payload, created_at)
           values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing`,
          [m.id, m.kind, scope, code, m.title, m.payload ?? {}, m.at],
        );
      }
    } catch (e) {
      console.warn('[pg] persistência falhou:', (e as Error).message);
    }
  }

  async close() {
    await this.redis?.quit().catch(() => {});
    await this.pool?.end().catch(() => {});
  }
}

export function loadState(file: string): PollState | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as PollState;
  } catch {
    return null;
  }
}
