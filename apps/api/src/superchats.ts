// Super Chats: registro em memória + persistência. Com DATABASE_URL: tabela `superchats` (o registro inteiro
// em jsonb); sem: var/superchats.ndjson (a última linha de um id vence). Volume baixo: tudo cabe na memória.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import type { ScStatus, Side } from '@apuracao/shared';
import type { Provider } from './pix';

export interface SuperChat {
  id: string;
  room: string;
  /** conta que pagou */
  uid: string;
  username: string;
  hue: number;
  side: Side | null;
  body: string;
  /** centavos */
  amount: number;
  status: ScStatus;
  provider: Provider;
  /** id da cobrança na Woovi */
  pid: string | null;
  qr: string;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  /** JSON exato publicado no chat (para tirar do histórico do Redis sem adivinhar a ordem das chaves) */
  json: string | null;
}

export class SuperChats {
  byId = new Map<string, SuperChat>();
  private file: string;
  private pool: pg.Pool | null;

  constructor(varDir: string, databaseUrl: string) {
    this.file = path.join(varDir, 'superchats.ndjson');
    this.pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl, max: 2 }) : null;
  }

  async init() {
    if (this.pool) {
      // a tabela vem do schema.sql (aplicado pelo PgStore dos palpites antes deste init)
      const { rows } = await this.pool.query('select data from superchats order by created_at');
      for (const r of rows) this.byId.set(r.data.id, r.data as SuperChat);
      return;
    }
    mkdirSync(path.dirname(this.file), { recursive: true });
    if (!existsSync(this.file)) return;
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const s = JSON.parse(line) as SuperChat;
      this.byId.set(s.id, s);
    }
  }

  async save(s: SuperChat) {
    this.byId.set(s.id, s);
    if (this.pool) {
      await this.pool.query(
        `insert into superchats (id, data, created_at) values ($1, $2, $3)
         on conflict (id) do update set data = excluded.data`,
        [s.id, s, s.createdAt],
      );
    } else appendFileSync(this.file, JSON.stringify(s) + '\n');
  }

  /** pendente vencido conta como expirado (sem precisar de varredura) */
  statusOf(s: SuperChat, now = Date.now()): ScStatus {
    return s.status === 'pending' && Date.parse(s.expiresAt) < now ? 'expired' : s.status;
  }

  list(n = 100) {
    return [...this.byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, n);
  }

  totals(since = 0) {
    let count = 0;
    let cents = 0;
    let pending = 0;
    for (const s of this.byId.values()) {
      const st = this.statusOf(s);
      if (st === 'pending') pending++;
      if ((st === 'paid' || st === 'hidden') && s.paidAt && Date.parse(s.paidAt) >= since) {
        count++;
        cents += s.amount;
      }
    }
    return { count, cents, pending };
  }
}
