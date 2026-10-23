// Punições graduais. Duas escadas independentes:
//  - spam: flood, mensagem repetida, insistir no limite de taxa, propaganda
//  - abuse: palavrão, ofensa, discriminação, ameaça, conteúdo sexual (com pesos diferentes)
// Os pontos viram silêncios crescentes e caem com o tempo. Valem por pessoa (id anônimo) e por IP;
// o IP precisa do dobro de pontos, porque operadoras de celular põem muita gente atrás do mesmo IP.
import type { ModCategory } from '@apuracao/shared';
import type { Bus } from './redis';

export type Ladder = 'spam' | 'abuse';

/** peso de cada categoria na escada de conteúdo impróprio */
export const WEIGHT: Record<ModCategory, number> = {
  palavrao: 1,
  link: 1,
  outro: 1,
  spam: 1,
  ofensa: 2,
  sexual: 2,
  discriminacao: 3,
  ameaca: 3,
};

/** [pontos mínimos, segundos de silêncio], do mais grave para o mais leve */
const STEPS: Record<Ladder, [number, number][]> = {
  abuse: [
    [9, 24 * 3600],
    [6, 2 * 3600],
    [4, 15 * 60],
    [2, 2 * 60],
  ],
  spam: [
    [8, 3600],
    [6, 10 * 60],
    [4, 2 * 60],
    [2, 30],
  ],
};

/** um ponto some a cada… */
const DECAY_MS: Record<Ladder, number> = { abuse: 30 * 60_000, spam: 5 * 60_000 };
const IP_FACTOR = 2;
const TTL_S = 24 * 3600;

interface Record_ {
  pts: Record<Ladder, number>;
  at: Record<Ladder, number>;
  muteUntil: number;
  reason: Ladder | null;
  /** quantas mensagens desta pessoa já foram barradas (24h) */
  blocks?: number;
}

const fresh = (): Record_ => ({ pts: { spam: 0, abuse: 0 }, at: { spam: Date.now(), abuse: Date.now() }, muteUntil: 0, reason: null, blocks: 0 });

function decay(r: Record_, now: number) {
  for (const l of ['spam', 'abuse'] as Ladder[]) {
    const n = Math.floor((now - r.at[l]) / DECAY_MS[l]);
    if (n > 0) {
      r.pts[l] = Math.max(0, r.pts[l] - n);
      r.at[l] += n * DECAY_MS[l];
    }
  }
}

export function muteFor(ladder: Ladder, points: number, factor = 1): number {
  for (const [min, s] of STEPS[ladder]) if (points >= min * factor) return s;
  return 0;
}

export interface Penalty {
  /** segundos de silêncio aplicados agora (0 = só aviso) */
  mute: number;
  ladder: Ladder;
  points: number;
  /** primeira mensagem barrada desta pessoa: aparece no chat para todos; as seguintes, não */
  first: boolean;
}

export class Strikes {
  private mem = new Map<string, Record_>();

  constructor(private bus: Bus | null) {}

  private async load(key: string): Promise<Record_> {
    if (this.bus?.ready()) {
      try {
        const raw = await this.bus.cmd.get(`strike:${key}`);
        if (raw) return JSON.parse(raw) as Record_;
        return fresh();
      } catch {
        /* cai para memória */
      }
    }
    return this.mem.get(key) ?? fresh();
  }

  private async save(key: string, r: Record_) {
    this.mem.set(key, r);
    if (this.mem.size > 50_000) this.mem.delete(this.mem.keys().next().value!);
    if (this.bus?.ready()) await this.bus.cmd.set(`strike:${key}`, JSON.stringify(r), 'EX', TTL_S).catch(() => {});
  }

  /** silêncio em vigor para esta pessoa ou este IP */
  async muted(user: string, ip: string): Promise<{ wait: number; reason: Ladder } | null> {
    const now = Date.now();
    let best: { wait: number; reason: Ladder } | null = null;
    for (const k of [`u:${user}`, `ip:${ip}`]) {
      const r = await this.load(k);
      if (r.muteUntil > now && r.reason) {
        const wait = Math.ceil((r.muteUntil - now) / 1000);
        if (!best || wait > best.wait) best = { wait, reason: r.reason };
      }
    }
    return best;
  }

  /** soma pontos e devolve o silêncio resultante (o maior entre pessoa e IP) */
  async add(user: string, ip: string, ladder: Ladder, points: number): Promise<Penalty> {
    const now = Date.now();
    let out: Penalty = { mute: 0, ladder, points: 0, first: false };
    for (const [k, factor] of [
      [`u:${user}`, 1],
      [`ip:${ip}`, IP_FACTOR],
    ] as const) {
      const r = await this.load(k);
      decay(r, now);
      r.pts[ladder] += points;
      r.at[ladder] = r.at[ladder] || now;
      const mute = muteFor(ladder, r.pts[ladder], factor);
      if (mute) {
        r.muteUntil = Math.max(r.muteUntil, now + mute * 1000);
        r.reason = ladder;
      }
      if (k.startsWith('u:')) {
        out.points = r.pts[ladder];
        out.first = !r.blocks;
        r.blocks = (r.blocks ?? 0) + 1;
      }
      await this.save(k, r);
      if (mute > out.mute) out = { ...out, mute };
    }
    return out;
  }
}
