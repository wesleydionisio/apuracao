import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { detectCandidates, parseResult } from '@apuracao/shared';
import { emptyState, runCycle, toBoard } from '../src/board';
import type { History } from '../src/history';

const fx = (f: string) => JSON.parse(readFileSync(new URL(`../../../packages/data/fixtures/${f}`, import.meta.url), 'utf8'));
const hist: History = { municipalities: [], byTse: new Map(), byIbge: new Map(), t1: null, t1Mun: {}, y22t2Mun: {}, y22t1Mun: {} };

test('2º turno zerado: não iniciada, e nada sai antes da liberação', () => {
  const br = parseResult(fx('t2-br.json'));
  const cands = detectCandidates(br);
  const map = { a: cands[0].n, b: cands[1].n };
  const r = runCycle(emptyState(), { cands, br, ufs: [], mun: [], hist, y2022Map: map, bigMunEl: 1 });
  assert.equal(r.state.br?.status, 'nao_iniciada');
  assert.equal(r.moments.length, 0);
  const opts = { cands, y2022Map: map, flags: { chat: true, projection: true, map_mun: true }, hist, releaseAt: new Date(), sourceUrl: '' };
  const hidden = toBoard(r.state, { ...opts, released: false });
  assert.equal(hidden.br, null);
  assert.deepEqual(hidden.ufs, {});
  assert.equal(hidden.projection, null);
  assert.equal(toBoard(r.state, { ...opts, released: true }).br?.status, 'nao_iniciada');
});

test('primeiro ciclo só semeia: não dispara marcos atrasados', () => {
  const br = parseResult(fx('t1-br.json')); // 100% apurado
  const cands = detectCandidates(br, { a: '13', b: '22' });
  const r = runCycle(emptyState(), { cands, br, ufs: [], mun: [], hist, y2022Map: { a: '13', b: '22' }, bigMunEl: 1 });
  assert.equal(r.moments.length, 0);
  assert.equal(r.state.curve.length, 1);
});

test('arquivo antigo do CDN do TSE não faz o placar voltar nem repetir marco', () => {
  const br = parseResult(fx('t2-br.json'));
  const cands = detectCandidates(br);
  const map = { a: cands[0].n, b: cands[1].n };
  const [na, nb] = [cands[0].n, cands[1].n];
  const zz = (at: string, pst: number, a: number, b: number) => ({
    ...br, scope: 'uf' as const, code: 'ZZ', at, pst, valid: a + b, votes: { [na]: a, [nb]: b },
  });
  const brAt = (at: string, pst: number) => ({ ...br, at, pst, valid: 1000, votes: { [na]: 600, [nb]: 400 } });
  const step = (st: ReturnType<typeof emptyState>, b: ReturnType<typeof brAt>, z: ReturnType<typeof zz>) =>
    runCycle(st, { cands, br: b, ufs: [z], mun: [], hist, y2022Map: map, bigMunEl: 1 });

  // véspera zerada → exterior chega com 57,59%: um marco, com o % real
  let r = step(emptyState(), brAt('2026-10-24T20:11:36-03:00', 0), zz('2026-10-24T20:11:36-03:00', 0, 0, 0));
  r = step(r.state, brAt('2026-10-25T17:06:58-03:00', 0.29), zz('2026-10-25T17:05:27-03:00', 57.59, 141386, 95551));
  assert.deepEqual(r.moments.map((m) => m.id), ['uf_milestone:ZZ:50']);
  assert.match(r.moments[0].title, /passa de 50% apurado \(57,6%\)/);

  // o CDN devolve a versão zerada da véspera: fica o que já tínhamos, sem mudança nem marco
  const kept = r.state;
  r = step(kept, brAt('2026-10-25T16:46:00-03:00', 0), zz('2026-10-24T20:11:36-03:00', 0, 0, 0));
  assert.equal(r.state.ufs['uf:ZZ'].pst, 57.59);
  assert.equal(r.state.br?.pst, 0.29);
  assert.equal(r.changed.length, 0);
  assert.equal(r.moments.length, 0);

  // e a versão nova de novo: segue normal, sem repetir o marco
  r = step(r.state, brAt('2026-10-25T19:02:54-03:00', 1.1), zz('2026-10-25T19:02:54-03:00', 60.47, 141386, 95551));
  assert.equal(r.state.ufs['uf:ZZ'].pst, 60.47);
  assert.equal(r.state.br?.pst, 1.1);
  assert.equal(r.moments.length, 0);

  // a hora guardada veio com o fuso errado e parece mais nova que a de agora: seção nova entra mesmo assim
  r = step(r.state, brAt('2026-10-25T19:29:15-03:00', 1.2), zz('2026-10-25T20:00:00-02:00', 60.55, 141405, 95672));
  assert.equal(r.state.ufs['uf:ZZ'].pst, 60.55);
  // e com as mesmas seções, a versão "mais velha" fica de fora
  r = step(r.state, brAt('2026-10-25T19:29:15-03:00', 1.2), zz('2026-10-25T19:59:00-02:00', 60.55, 141405, 95672));
  assert.equal(r.state.ufs['uf:ZZ'].at, '2026-10-25T20:00:00-02:00');
});

test('projeção: sem modelo por cidade usa o modelo por UF; "à frente" só depois de ciclos seguidos', async () => {
  const { projectionStep } = await import('../src/board');
  const { toSnap } = await import('@apuracao/shared');
  const br = parseResult(fx('t1-br.json'));
  const cands = detectCandidates(br, { a: '13', b: '22' });
  // 1º turno 2026 inteiro como se fosse um parcial de 40%: o modelo por UF precisa do 1º turno por UF
  const snap = { ...toSnap(br, cands, { key: 'br' }), pst: 40, status: 'apurando' as const, rem: 30_000_000 };
  const uf = { ...snap, s: 'uf:SP', rem: 30_000_000 };
  const h = { ...hist, t1: { label: '', year: 2026, round: 1 as const, br: null, uf: { SP: { el: 1, turnout: 1, abst: 0, valid: 1, blank: 0, nulls: 0, votes: { '13': 30, '22': 70 } } }, mun: {} } };
  const st = { ...emptyState(), br: snap, ufs: { 'uf:SP': uf } };
  const step = (s: typeof st) => projectionStep(s, { model: null, prog: new Map(), cands, hist: h, minPst: 20 });
  const r1 = step(st);
  assert.equal(r1.proj.last?.model, 'uf');
  assert.equal(r1.report?.reason, 'sem histórico por cidade');
  const side = r1.proj.last!.lo > 50 ? 'a' : r1.proj.last!.hi < 50 ? 'b' : null;
  assert.ok(side, 'a faixa deste exemplo exclui 50%');
  assert.equal(r1.proj.last?.lead, null, 'primeiro ciclo: ainda não mostra à frente');
  const r2 = step({ ...st, proj: r1.proj });
  assert.equal(r2.proj.last?.lead, side);
  // abaixo do mínimo: some
  const r3 = step({ ...st, br: { ...snap, pst: 10 }, proj: r2.proj });
  assert.equal(r3.proj.last, null);
});
