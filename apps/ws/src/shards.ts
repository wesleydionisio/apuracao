// Subsalas invisíveis: uma sala grande ("br" com 30 mil pessoas) vira N conversas de ~SHARD_SIZE pessoas.
// Quem está na sala não vê a divisão: mesmo nome, mesma torcida, mesmo histórico e momentos; só o fluxo de
// mensagens é por subsala, cada uma com o seu teto de mensagens por segundo. A banda por pessoa fica
// limitada pelo teto, não pelo tamanho da sala.

const MASK = (1n << 64n) - 1n;

/** chave de 64 bits estável para a pessoa (primeiros 8 bytes de um sha256) */
export const shardKey = (digest: Buffer) => digest.readBigUInt64BE(0);

/**
 * Jump consistent hash (Lamping & Veach): quando N cresce para N+1, só ~1/(N+1) das pessoas mudam de
 * subsala; as outras continuam na mesma conversa.
 */
export function jump(key: bigint, buckets: number): number {
  let k = key & MASK;
  let b = -1;
  let j = 0;
  while (j < buckets) {
    b = j;
    k = (k * 2862933555777941757n + 1n) & MASK;
    j = Math.floor((b + 1) * (2 ** 31 / (Number(k >> 33n) + 1)));
  }
  return Math.max(0, b);
}

/**
 * Quantas subsalas a sala deve ter com `total` pessoas, partindo de `cur`. Cresce assim que passa do
 * tamanho; só encolhe com folga (30% abaixo), para não ficar mudando gente de conversa na beirada.
 */
export function nextShardCount(cur: number, total: number, size: number): number {
  const want = Math.max(1, Math.ceil(total / size));
  if (want > cur) return want;
  if (want < cur && total < (cur - 1) * size * 0.7) return want;
  return Math.max(1, cur);
}

export const shardId = (room: string, k: number) => `${room}#${k}`;
