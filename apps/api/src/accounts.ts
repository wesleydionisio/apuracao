// Contas do chat (login com o Google). Com DATABASE_URL: tabela `accounts`; sem: var/accounts.ndjson (dev).
// Nome e celular ficam só aqui; para fora vai o nome de usuário.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export interface Account {
  id: string;
  googleSub: string;
  email: string;
  name: string;
  phone: string;
  username: string;
  createdAt: string;
}

export interface AccountStore {
  init(): Promise<void>;
  bySub(sub: string): Promise<Account | null>;
  byId(id: string): Promise<Account | null>;
  /** painel admin: total, quantas nas últimas 24h e as mais novas */
  summary(n: number): Promise<{ total: number; day: number; recent: Account[] }>;
  usernameTaken(username: string): Promise<boolean>;
  /** false se o nome de usuário (ou a conta Google) já existe */
  create(a: Account): Promise<boolean>;
}

const key = (u: string) => u.toLocaleLowerCase('pt-BR');

export class FileAccounts implements AccountStore {
  private file: string;
  private subs = new Map<string, Account>();
  private ids = new Map<string, Account>();
  private names = new Set<string>();
  constructor(varDir: string) {
    this.file = path.join(varDir, 'accounts.ndjson');
  }
  async init() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    if (!existsSync(this.file)) return;
    for (const line of readFileSync(this.file, 'utf8').split('\n')) if (line.trim()) this.add(JSON.parse(line));
  }
  private add(a: Account) {
    this.subs.set(a.googleSub, a);
    this.ids.set(a.id, a);
    this.names.add(key(a.username));
  }
  async bySub(sub: string) {
    return this.subs.get(sub) ?? null;
  }
  async byId(id: string) {
    return this.ids.get(id) ?? null;
  }
  async summary(n: number) {
    const all = [...this.ids.values()];
    const since = Date.now() - 86_400_000;
    return {
      total: all.length,
      day: all.filter((a) => Date.parse(a.createdAt) >= since).length,
      recent: all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, n),
    };
  }
  async usernameTaken(u: string) {
    return this.names.has(key(u));
  }
  async create(a: Account) {
    if (this.subs.has(a.googleSub) || this.names.has(key(a.username))) return false;
    this.add(a);
    appendFileSync(this.file, JSON.stringify(a) + '\n');
    return true;
  }
}

export class PgAccounts implements AccountStore {
  constructor(private pool: pg.Pool) {}
  async init() {
    // a tabela vem do schema.sql, que o PgStore dos palpites já aplica
  }
  private static row(r: Record<string, any>): Account {
    return { id: r.id, googleSub: r.google_sub, email: r.email, name: r.name, phone: r.phone, username: r.username, createdAt: r.created_at.toISOString() };
  }
  private async one(where: string, v: string) {
    const { rows } = await this.pool.query(`select id, google_sub, email, name, phone, username, created_at from accounts where ${where} = $1`, [v]);
    return rows[0] ? PgAccounts.row(rows[0]) : null;
  }
  async bySub(sub: string) {
    return this.one('google_sub', sub);
  }
  async byId(id: string) {
    return this.one('id', id);
  }
  async summary(n: number) {
    const [c, r] = await Promise.all([
      this.pool.query(`select count(*)::int as total, count(*) filter (where created_at > now() - interval '1 day')::int as day from accounts`),
      this.pool.query('select id, google_sub, email, name, phone, username, created_at from accounts order by created_at desc limit $1', [n]),
    ]);
    return { total: c.rows[0].total, day: c.rows[0].day, recent: r.rows.map(PgAccounts.row) };
  }
  async usernameTaken(u: string) {
    const { rowCount } = await this.pool.query('select 1 from accounts where lower(username) = lower($1)', [u]);
    return !!rowCount;
  }
  async create(a: Account) {
    const { rowCount } = await this.pool.query(
      `insert into accounts (id, google_sub, email, name, phone, username, created_at)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`,
      [a.id, a.googleSub, a.email, a.name, a.phone, a.username, a.createdAt],
    );
    return !!rowCount;
  }
}
