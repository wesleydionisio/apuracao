// Estado do placar no worker: snapshots por escopo + momentos já vistos.
// Duas fontes alimentam o mesmo diff: Redis (CH.snap / CH.moment, instantâneo) e o arquivo
// DATA_DIR/br.json lido a cada 2s (modo arquivo em dev, fallback se o Redis cair).
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Board, Flags, Moment, Snap } from '@apuracao/shared';
import { config } from './config';

export interface BoardEvents {
  onSnaps: (changed: Snap[]) => void;
  onMoment: (m: Moment) => void;
  onRelease: () => void;
  onBoardFlags: (f: Flags) => void;
}

export class BoardState {
  snaps = new Map<string, Snap>();
  private sig = new Map<string, string>();
  private seenMoments = new Set<string>();
  private boardReleased: boolean | null = null;
  private wasReleased = false;
  private mtime = 0;
  private primed = false;
  /** último instante (ms) em que um snapshot novo chegou, por qualquer fonte */
  lastSnapAt = 0;
  /** generatedAt do último br.json lido */
  boardGeneratedAt: string | null = null;
  boardFlags: Flags | null = null;

  constructor(private ev: BoardEvents) {}

  released(now = Date.now()): boolean {
    return now >= config.releaseAt.getTime() && this.boardReleased !== false;
  }

  /** aplica snapshots; publica só os que mudaram */
  apply(snaps: Snap[]) {
    const changed: Snap[] = [];
    for (const s of snaps) {
      if (!s?.s) continue;
      const sig = JSON.stringify(s);
      if (this.sig.get(s.s) === sig) continue;
      this.sig.set(s.s, sig);
      this.snaps.set(s.s, s);
      changed.push(s);
    }
    if (changed.length) {
      this.lastSnapAt = Date.now();
      if (this.released()) this.ev.onSnaps(changed);
    }
    this.checkRelease();
  }

  moment(m: Moment) {
    if (!m?.id || this.seenMoments.has(m.id)) return;
    this.seenMoments.add(m.id);
    if (this.released()) this.ev.onMoment(m);
  }

  checkRelease() {
    const r = this.released();
    if (r && !this.wasReleased) {
      this.wasReleased = true;
      this.ev.onRelease();
    }
    if (!r) this.wasReleased = false;
  }

  async pollFile() {
    const file = join(config.dataDir, 'br.json');
    try {
      const st = await stat(file);
      if (st.mtimeMs === this.mtime) return this.checkRelease();
      const board = JSON.parse(await readFile(file, 'utf8')) as Board;
      this.mtime = st.mtimeMs;
      this.boardReleased = board.released;
      this.boardGeneratedAt = board.generatedAt;
      if (board.flags && JSON.stringify(board.flags) !== JSON.stringify(this.boardFlags)) {
        this.boardFlags = board.flags;
        this.ev.onBoardFlags(board.flags);
      }
      const snaps = [board.br, ...Object.values(board.ufs ?? {})].filter(Boolean) as Snap[];
      if (!this.primed) {
        // na partida, momentos que já estão no arquivo não são re-anunciados
        for (const m of board.moments ?? []) this.seenMoments.add(m.id);
        this.primed = true;
      }
      this.apply(snaps);
      // anuncia em ordem cronológica, independente da ordem no arquivo
      const ms = [...(board.moments ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      for (const m of ms) this.moment(m);
    } catch (e) {
      // arquivo ausente ou no meio de uma escrita: tenta de novo no próximo ciclo
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[board]', (e as Error).message);
      this.checkRelease();
    }
  }

  /** snapshot de um escopo, só se já liberado */
  get(scope: string): Snap | undefined {
    return this.released() ? this.snaps.get(scope) : undefined;
  }
}
