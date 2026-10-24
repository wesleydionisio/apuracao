import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatMsg } from '@apuracao/shared';
import { ChatStore } from '../src/chat';
import type { Bus } from '../src/redis';

const msg = (i: number): ChatMsg => ({ id: `m${i}`, nick: 'x', hue: 0, body: `oi ${i}`, at: i });

/** Redis falso: a lista de chat como o LPUSH deixaria (mais nova primeiro) */
function fakeBus(rows: string[]) {
  let lrange = 0;
  const bus = {
    cmd: { lrange: async (_k: string, a: number, b: number) => (lrange++, rows.slice(a, b + 1)) },
    sub: { on: () => {} },
    ready: () => true,
  } as unknown as Bus;
  return { bus, calls: () => lrange };
}

test('histórico: espelho frio vai ao Redis; quente serve do espelho, mesma ordem e forma', async () => {
  const all = Array.from({ length: 60 }, (_, i) => msg(i));
  const { bus, calls } = fakeBus(all.map((m) => JSON.stringify(m)).reverse());
  const s = new ChatStore(bus);
  for (const m of all.slice(0, 10)) s.mirror('br', m, JSON.stringify(m));
  const cold = await s.history('br', 50);
  assert.equal(calls(), 1);
  for (const m of all.slice(10)) s.mirror('br', m, JSON.stringify(m));
  const warm = await s.history('br', 50);
  assert.equal(calls(), 1);
  assert.deepEqual(warm, cold);
  assert.deepEqual(warm.map((m) => m.id), all.slice(10).map((m) => m.id));
});

test('histórico: versão muda ao espelhar e ao remover', async () => {
  const s = new ChatStore(null);
  const v0 = s.version('br');
  s.mirror('br', msg(1), JSON.stringify(msg(1)));
  const v1 = s.version('br');
  assert.notEqual(v1, v0);
  await s.remove('br', 'm1');
  assert.notEqual(s.version('br'), v1);
  assert.deepEqual(await s.history('br', 50), []);
});
