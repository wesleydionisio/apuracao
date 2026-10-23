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
  usernameTaken(username: string): Promise<boolean>;
  /** false se o nome de usuário (ou a conta Google) já existe */
  create(a: Account): Promise<boolean>;
}

const key = (u: string) => u.toLocaleLowerCase('pt-BR');

export class FileAccounts implements AccountStore {
  private file: string;
  private subs = new Map<string, Account>();
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
    this.names.add(key(a.username));
  }
  async bySub(sub: string) {
    return this.subs.get(sub) ?? null;
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
  async bySub(sub: string) {
    const { rows } = await this.pool.query(
      'select id, google_sub, email, name, phone, username, created_at from accounts where google_sub = $1',
      [sub],
    );
    const r = rows[0];
    return r
      ? { id: r.id, googleSub: r.google_sub, email: r.email, name: r.name, phone: r.phone, username: r.username, createdAt: r.created_at.toISOString() }
      : null;
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
