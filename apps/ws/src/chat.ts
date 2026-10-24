// Histórico efêmero (últimas 200 por sala) e denúncias. Redis quando disponível, senão memória.
import { KEY, type ChatMsg, type Room } from '@apuracao/shared';
import { config } from './config';
import type { Bus } from './redis';

const MAX_TRACKED = 50_000;

export class ChatStore {
  /** espelho local do que este worker entregou (histórico em modo memória e fallback) */
  private mem = new Map<Room, ChatMsg[]>();
  /** id da mensagem -> JSON exato gravado no Redis (para LREM) e autor (anti auto-denúncia) */
  private tracked = new Map<string, { room: Room; json: string; author?: string }>();
  private reports = new Map<string, Set<string>>();
  /** muda a cada mensagem espelhada ou removida na sala (invalida o frame de histórico em cache) */
  private ver = new Map<Room, number>();
  /** de onde saiu o histórico do join */
  stats = { mem: 0, redis: 0 };

  constructor(private bus: Bus | null) {
    // pub/sub caiu e voltou: o espelho pode ter buraco; fica frio (Redis) até encher de novo
    bus?.sub.on('ready', () => this.mem.clear());
  }

  version(room: Room) {
    return this.ver.get(room) ?? 0;
  }

  private bump(room: Room) {
    this.ver.set(room, (this.ver.get(room) ?? 0) + 1);
  }

  /** registra uma mensagem entregue localmente */
  mirror(room: Room, m: ChatMsg, json: string, author?: string) {
    let list = this.mem.get(room);
    if (!list) this.mem.set(room, (list = []));
    list.push(m);
    if (list.length > config.historySize) list.splice(0, list.length - config.historySize);
    this.bump(room);
    const prev = this.tracked.get(m.id);
    this.tracked.set(m.id, { room, json, author: author ?? prev?.author });
    if (this.tracked.size > MAX_TRACKED) this.tracked.delete(this.tracked.keys().next().value!);
  }

  /** grava no histórico compartilhado (Redis). Em modo memória, mirror() já basta. */
  async persist(room: Room, json: string) {
    if (!this.bus?.ready()) return;
    await this.bus.cmd
      .multi()
      .lpush(KEY.chat(room), json)
      .ltrim(KEY.chat(room), 0, config.historySize - 1)
      .exec();
  }

  /**
   * últimas `n` da sala, da mais velha para a mais nova. O espelho é o mesmo fluxo que o Redis guardou:
   * se já tem `n`, serve dele (tempestade de reconexão sem tocar no Redis); o Redis fica para o worker frio.
   */
  async history(room: Room, n: number): Promise<ChatMsg[]> {
    const local = this.mem.get(room);
    if (local && local.length >= n) {
      this.stats.mem++;
      return local.slice(-n);
    }
    if (this.bus?.ready()) {
      try {
        const rows = await this.bus.cmd.lrange(KEY.chat(room), 0, n - 1);
        this.stats.redis++;
        return rows.reverse().map((r) => JSON.parse(r) as ChatMsg);
      } catch {
        /* cai para memória */
      }
    }
    return (this.mem.get(room) ?? []).slice(-n);
  }

  authorOf(id: string) {
    return this.tracked.get(id)?.author;
  }

  roomOf(id: string) {
    return this.tracked.get(id)?.room;
  }

  /** conta denúncias distintas; devolve o total */
  async report(id: string, reporter: string): Promise<number> {
    if (this.bus?.ready()) {
      try {
        const k = `report:${id}`;
        const [, , [, n]] = (await this.bus.cmd.multi().sadd(k, reporter).expire(k, 3600).scard(k).exec()) as [
          unknown,
          unknown,
          [unknown, number],
        ];
        return n;
      } catch {
        /* memória */
      }
    }
    let s = this.reports.get(id);
    if (!s) this.reports.set(id, (s = new Set()));
    s.add(reporter);
    if (this.reports.size > MAX_TRACKED) this.reports.delete(this.reports.keys().next().value!);
    return s.size;
  }

  /** remove do histórico local e do Redis */
  async remove(room: Room, id: string) {
    const list = this.mem.get(room);
    if (list) this.mem.set(room, list.filter((m) => m.id !== id));
    this.bump(room);
    const t = this.tracked.get(id);
    if (t && this.bus?.ready()) await this.bus.cmd.lrem(KEY.chat(room), 1, t.json).catch(() => {});
  }
}
