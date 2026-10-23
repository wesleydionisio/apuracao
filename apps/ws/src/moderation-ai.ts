// Moderação por modelo de decisão (OpenRouter Decisions API, ex.: inception/mercury-decide).
// Junta as mensagens de uma janela curta numa única chamada (uma pergunta "choice" por mensagem),
// guarda veredito de textos repetidos e, se o serviço falhar, abre um disjuntor: o chat segue só
// com o filtro local até o modelo voltar. Nunca derruba o chat por causa da moderação.
import type { ModCategory } from '@apuracao/shared';
import { normalize } from '@apuracao/shared';

export type AiCategory = 'ok' | Exclude<ModCategory, 'link' | 'outro'>;

export interface Verdict {
  /** 'unknown' = modelo indisponível (disjuntor aberto, timeout ou erro) */
  cat: AiCategory | 'unknown';
  confidence: number;
  /** probabilidade de a mensagem ser aceitável (1 quando desconhecido) */
  pOk: number;
}

export interface AiModConfig {
  apiKey: string;
  model: string;
  endpoint: string;
  batchMs: number;
  maxBatch: number;
  concurrency: number;
  timeoutMs: number;
  threshold: number;
}

/** critérios curtos: são repetidos em cada pergunta do lote, então cada palavra custa tokens */
const CRITERIA: Record<AiCategory, string> = {
  ok: 'Aceitável: opinião, torcida, comentário sobre a apuração. Críticas, acusações e apelidos políticos contra candidatos e políticos são permitidos (ex.: chamar de ladrão, corrupto, mentiroso), desde que sem palavrão.',
  palavrao: 'Palavrão ou linguagem obscena, inclusive dirigido a candidato ou político.',
  ofensa: 'Xinga ou humilha diretamente outra pessoa do chat (não um candidato ou político).',
  discriminacao: 'Racismo, homofobia, transfobia, misoginia, xenofobia, capacitismo ou ataque a grupo por identidade.',
  ameaca: 'Ameaça, incitação à violência ou apologia a crime.',
  sexual: 'Conteúdo sexual explícito.',
  spam: 'Propaganda, autopromoção, pedido de seguidores, flood ou texto repetido sem conteúdo.',
};

const STATE =
  'Chat ao vivo de um site brasileiro de apuração da eleição presidencial. Política, torcida e críticas duras aos candidatos são permitidas; modera-se palavrão, ataque a pessoas do chat, discriminação, ameaça e spam, não a opinião.';

interface Pending {
  text: string;
  resolve: (v: Verdict) => void;
}

export class AiModerator {
  private queue: Pending[] = [];
  private timer: NodeJS.Timeout | null = null;
  private inFlight = 0;
  private cache = new Map<string, Verdict>();
  private openUntil = 0;
  private failures = 0;
  readonly stats = { calls: 0, messages: 0, cacheHits: 0, errors: 0, timeouts: 0, unknown: 0, flagged: 0, lastMs: 0, circuitOpenUntil: 0 };

  constructor(private cfg: AiModConfig) {}

  get enabled() {
    return !!this.cfg.apiKey;
  }

  get circuitOpen() {
    return Date.now() < this.openUntil;
  }

  /** veredito para um texto; resolve sempre (nunca rejeita) */
  classify(text: string): Promise<Verdict> {
    if (!this.enabled || this.circuitOpen) {
      this.stats.unknown++;
      return Promise.resolve({ cat: 'unknown', confidence: 0, pOk: 1 });
    }
    const key = normalize(text);
    const hit = this.cache.get(key);
    if (hit) {
      this.stats.cacheHits++;
      return Promise.resolve(hit);
    }
    return new Promise((resolve) => {
      this.queue.push({ text, resolve });
      if (this.queue.length >= this.cfg.maxBatch) this.flush();
      else this.timer ??= setTimeout(() => this.flush(), this.cfg.batchMs);
    });
  }

  /**
   * Bloqueia quando a chance de ser aceitável fica abaixo do limiar, qualquer que seja a categoria:
   * "vai se f…" divide a certeza entre ofensa e palavrão, mas P(ok) é zero.
   */
  isFlagged(v: Verdict): v is Verdict & { cat: Exclude<AiCategory, 'ok'> } {
    return v.cat !== 'unknown' && v.cat !== 'ok' && v.pOk < this.cfg.threshold;
  }

  private flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.queue.length) return;
    // sem vaga: tenta de novo em seguida (a fila continua acumulando até maxBatch)
    if (this.inFlight >= this.cfg.concurrency) {
      this.timer = setTimeout(() => this.flush(), this.cfg.batchMs);
      return;
    }
    const batch = this.queue.splice(0, this.cfg.maxBatch);
    this.inFlight++;
    void this.send(batch).finally(() => {
      this.inFlight--;
      if (this.queue.length) this.flush();
    });
  }

  private async send(batch: Pending[]) {
    const questions = Object.fromEntries(
      batch.map((p, i) => [
        `m${i}`,
        { type: 'choice', instructions: `Classifique esta mensagem do chat: """${p.text.replace(/"""/g, '"')}"""`, criteria: CRITERIA },
      ]),
    );
    const t0 = Date.now();
    this.stats.calls++;
    this.stats.messages += batch.length;
    try {
      const res = await fetch(this.cfg.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.cfg.apiKey}`,
          'content-type': 'application/json',
          'x-title': 'apuracao-chat',
        },
        body: JSON.stringify({ model: this.cfg.model, state: [STATE], questions }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
      this.stats.lastMs = Date.now() - t0;
      if (!res.ok) throw new HttpError(res.status, (await res.text()).slice(0, 200));
      const json = (await res.json()) as {
        answers?: Record<string, { choice?: string; confidence?: number; probabilities?: Record<string, number> }>;
      };
      batch.forEach((p, i) => {
        const a = json.answers?.[`m${i}`];
        let cat = (a?.choice && a.choice in CRITERIA ? a.choice : 'unknown') as Verdict['cat'];
        const probs = a?.probabilities ?? {};
        const pOk = cat === 'unknown' ? 1 : (probs.ok ?? (cat === 'ok' ? (a?.confidence ?? 1) : 1 - (a?.confidence ?? 1)));
        // se o modelo escolheu "ok" por pouco mas a soma das outras passa, usa a mais provável entre elas
        if (cat === 'ok' && pOk < this.cfg.threshold) {
          const worst = Object.entries(probs).filter(([k]) => k !== 'ok').sort((x, y) => y[1] - x[1])[0];
          if (worst) cat = worst[0] as AiCategory;
        }
        const v: Verdict = { cat, confidence: a?.confidence ?? (cat === 'unknown' ? 0 : 1), pOk };
        if (cat !== 'unknown') this.remember(normalize(p.text), v);
        if (this.isFlagged(v)) this.stats.flagged++;
        p.resolve(v);
      });
      this.failures = 0;
    } catch (e) {
      const timeout = (e as Error).name === 'TimeoutError';
      if (timeout) this.stats.timeouts++;
      else this.stats.errors++;
      this.failures++;
      // 429/402/5xx seguidos ou timeout: abre o disjuntor por um tempo que cresce com as falhas
      const status = e instanceof HttpError ? e.status : 0;
      if (timeout || status === 429 || status === 402 || status >= 500 || this.failures >= 3) {
        const ms = Math.min(5 * 60_000, 15_000 * 2 ** Math.min(4, this.failures - 1));
        this.openUntil = Date.now() + ms;
        this.stats.circuitOpenUntil = this.openUntil;
        console.warn(`[moderação-ia] ${timeout ? 'timeout' : `erro ${status || (e as Error).message}`}; disjuntor aberto por ${ms / 1000}s`);
      }
      this.stats.unknown += batch.length;
      for (const p of batch) p.resolve({ cat: 'unknown', confidence: 0, pOk: 1 });
    }
  }

  private remember(key: string, v: Verdict) {
    if (this.cache.size >= 5000) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, v);
  }
}

class HttpError extends Error {
  constructor(
    public status: number,
    body: string,
  ) {
    super(`HTTP ${status}: ${body}`);
  }
}
