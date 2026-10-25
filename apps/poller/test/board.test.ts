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
