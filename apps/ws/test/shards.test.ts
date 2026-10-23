import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { jump, nextShardCount, shardKey } from '../src/shards';

const keys = Array.from({ length: 20_000 }, (_, i) => shardKey(createHash('sha256').update(`u-${i}`).digest()));

test('jump: fica no intervalo e espalha por igual', () => {
  const n = 8;
  const counts = new Array(n).fill(0);
  for (const k of keys) {
    const b = jump(k, n);
    assert.ok(b >= 0 && b < n);
    counts[b]++;
  }
  const avg = keys.length / n;
  for (const c of counts) assert.ok(Math.abs(c - avg) / avg < 0.1, `desbalanceado: ${counts}`);
});

test('jump: crescer de N para N+1 move só ~1/(N+1)', () => {
  let moved = 0;
  for (const k of keys) {
    const a = jump(k, 5);
    const b = jump(k, 6);
    if (a !== b) {
      moved++;
      assert.equal(b, 5, 'quem muda vai para a subsala nova');
    }
  }
  const frac = moved / keys.length;
  assert.ok(frac > 1 / 6 - 0.03 && frac < 1 / 6 + 0.03, `moveu ${frac}`);
});

test('jump: uma subsala só é sempre 0', () => {
  for (const k of keys.slice(0, 100)) assert.equal(jump(k, 1), 0);
});

test('nextShardCount: cresce na hora, encolhe com folga', () => {
  assert.equal(nextShardCount(1, 0, 1500), 1);
  assert.equal(nextShardCount(1, 1500, 1500), 1);
  assert.equal(nextShardCount(1, 1501, 1500), 2);
  assert.equal(nextShardCount(2, 30_000, 1500), 20);
  // 20 subsalas, caiu para 25 mil: ainda não encolhe
  assert.equal(nextShardCount(20, 25_000, 1500), 20);
  // caiu bem (abaixo de 70% de 19 × 1500): encolhe para o necessário
  assert.equal(nextShardCount(20, 15_000, 1500), 10);
  assert.equal(nextShardCount(3, 0, 1500), 1);
});
