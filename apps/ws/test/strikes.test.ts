import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Bus } from '../src/redis';
import { muteFor, Strikes, WEIGHT } from '../src/strikes';

test('escada de conteúdo impróprio: aviso, depois silêncios crescentes', () => {
  assert.equal(muteFor('abuse', 1), 0); // primeiro palavrão: só aviso
  assert.equal(muteFor('abuse', 2), 120);
  assert.equal(muteFor('abuse', 4), 15 * 60);
  assert.equal(muteFor('abuse', 6), 2 * 3600);
  assert.equal(muteFor('abuse', 9), 24 * 3600);
});

test('IP precisa do dobro de pontos (CGNAT)', () => {
  assert.equal(muteFor('abuse', 2, 2), 0);
  assert.equal(muteFor('abuse', 4, 2), 120);
});

test('racismo pesa mais que palavrão', () => {
  assert.ok(WEIGHT.discriminacao > WEIGHT.palavrao);
  assert.ok(WEIGHT.ameaca > WEIGHT.palavrao);
});

test('Strikes: palavrão avisa, reincidência silencia, e o silêncio vale para o IP também', async () => {
  const s = new Strikes(null);
  const a = await s.add('u1', '1.1.1.1', 'abuse', WEIGHT.palavrao);
  assert.equal(a.mute, 0);
  assert.equal(await s.muted('u1', '1.1.1.1'), null);
  const b = await s.add('u1', '1.1.1.1', 'abuse', WEIGHT.ofensa);
  assert.equal(b.mute, 120);
  const m = await s.muted('u1', '1.1.1.1');
  assert.equal(m?.reason, 'abuse');
  assert.ok(m!.wait > 100 && m!.wait <= 120);
  // outra pessoa no mesmo IP ainda não foi silenciada (IP só com o dobro de pontos)
  assert.equal(await s.muted('u2', '1.1.1.1'), null);
});

test('Strikes: racismo direto já silencia na primeira', async () => {
  const s = new Strikes(null);
  const p = await s.add('u9', '9.9.9.9', 'abuse', WEIGHT.discriminacao);
  assert.equal(p.mute, 120);
});

test('Strikes: spam começa leve (30s)', async () => {
  const s = new Strikes(null);
  assert.equal((await s.add('u3', '3.3.3.3', 'spam', 1)).mute, 0);
  assert.equal((await s.add('u3', '3.3.3.3', 'spam', 1)).mute, 30);
});

test('Strikes: muted() guarda o veredito 5 s, e a punição deste worker vale na hora', async () => {
  const db = new Map<string, string>();
  let gets = 0;
  const bus = {
    cmd: {
      get: async (k: string) => (gets++, db.get(k) ?? null),
      set: async (k: string, v: string) => (db.set(k, v), 'OK'),
    },
    ready: () => true,
  } as unknown as Bus;
  const s = new Strikes(bus);
  assert.equal(await s.muted('u5', '5.5.5.5'), null);
  assert.equal(gets, 2);
  assert.equal(await s.muted('u5', '5.5.5.5'), null);
  assert.equal(gets, 2); // do cache
  await s.add('u5', '5.5.5.5', 'abuse', WEIGHT.discriminacao);
  const m = await s.muted('u5', '5.5.5.5');
  assert.equal(m?.reason, 'abuse');
});
