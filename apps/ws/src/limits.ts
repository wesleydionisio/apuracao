// Token bucket e contador de taxa por sala (para o slow mode automático).

export class Bucket {
  private tokens: number;
  private last = Date.now();
  constructor(
    private burst: number,
    private refillPerSec: number,
  ) {
    this.tokens = burst;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.refillPerSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
  /** ms até o próximo token */
  wait(): number {
    return Math.ceil(((1 - this.tokens) / this.refillPerSec) * 1000);
  }
}

/** Buckets por chave (IP), com limpeza periódica das chaves ociosas. */
export class BucketMap {
  private map = new Map<string, { b: Bucket; seen: number }>();
  constructor(
    private burst: number,
    private refill: number,
  ) {}
  take(key: string): boolean {
    let e = this.map.get(key);
    if (!e) this.map.set(key, (e = { b: new Bucket(this.burst, this.refill), seen: 0 }));
    e.seen = Date.now();
    return e.b.take();
  }
  sweep(maxIdleMs = 60_000) {
    const cutoff = Date.now() - maxIdleMs;
    for (const [k, e] of this.map) if (e.seen < cutoff) this.map.delete(k);
  }
}

/** Janela deslizante de 5s em baldes de 1s. */
export class RateWindow {
  private slots = [0, 0, 0, 0, 0];
  private i = 0;
  hit() {
    this.slots[this.i]++;
  }
  /** chamar 1×/s */
  tick(): number {
    const rate = this.slots.reduce((a, b) => a + b, 0) / this.slots.length;
    this.i = (this.i + 1) % this.slots.length;
    this.slots[this.i] = 0;
    return rate;
  }
}
