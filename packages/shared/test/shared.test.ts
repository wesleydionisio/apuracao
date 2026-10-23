import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  detectCandidates,
  detectMoments,
  expectedRemaining,
  flipped,
  isMathDefined,
  Moderator,
  needPct,
  parseMunicipalities,
  parseProgress,
  parseResult,
  project,
  toSnap,
  transfer,
  type HistRow,
  type Snap,
} from '../src/index';

const fx = (f: string) => JSON.parse(readFileSync(new URL(`../../data/fixtures/${f}`, import.meta.url), 'utf8'));

test('parseResult lê o BR do 1º turno 2026', () => {
  const p = parseResult(fx('t1-br.json'));
  assert.equal(p.scope, 'br');
  assert.equal(p.round, 1);
  assert.equal(p.pst, 100);
  assert.equal(p.totalized, true);
  assert.equal(p.el, 158745502);
  assert.equal(p.valid, 119300788);
  const sum = Object.values(p.votes).reduce((x, y) => x + y, 0);
  assert.equal(sum, p.valid);
  assert.equal(p.at, '2026-10-05T12:51:05-03:00');
});

test('parseResult lê município e UF', () => {
  const m = parseResult(fx('t1-sp71072.json'));
  assert.equal(m.scope, 'mun');
  assert.equal(m.code, '71072');
  const uf = parseResult(fx('t1-sp.json'));
  assert.equal(uf.scope, 'uf');
  assert.equal(uf.code, 'SP');
});

test('2º turno ainda zerado: dois candidatos, status não iniciada', () => {
  const p = parseResult(fx('t2-br.json'));
  assert.equal(p.round, 2);
  const cands = detectCandidates(p);
  assert.equal(cands.length, 2);
  assert.notEqual(cands[0].n, cands[1].n);
  const s = toSnap(p, cands);
  assert.equal(s.status, 'nao_iniciada');
  assert.equal(s.need, null);
  assert.equal(s.rmax, p.el);
});

test('andamento e de-para de municípios', () => {
  const rows = parseProgress(fx('t2-br-ab.json'));
  assert.ok(rows.find((r) => r.uf === 'SP'));
  const mun = parseMunicipalities(fx('t2-mun-cm.json'));
  assert.ok(mun.length > 5500);
  const sp = mun.find((m) => m.tse === '71072')!;
  assert.equal(sp.ibge, '3550308');
  assert.equal(sp.uf, 'SP');
});

test('needPct: atrás precisa de (lead+R)/2R', () => {
  assert.equal(needPct(100, 1000), 55);
  assert.equal(needPct(-100, 1000), 55);
  assert.equal(needPct(0, 1000), 50);
  assert.equal(needPct(100, 0), null);
  assert.ok(needPct(2000, 1000)! > 100);
  assert.equal(isMathDefined(1001, 1000), true);
  assert.equal(isMathDefined(1000, 1000), false);
});

test('expectedRemaining usa fallback sem nada apurado', () => {
  assert.equal(expectedRemaining(1000, 0, 0, 0, { turnout: 0.8, valid: 0.9 }), 720);
  assert.equal(expectedRemaining(1000, 1000, 800, 760), 0);
  // 50% apurado com comparecimento 70% e 100% válidos: usa o observado
  assert.equal(expectedRemaining(1000, 500, 350, 350, { turnout: 0.8, valid: 0.9 }), 350);
});

const cands = [
  { key: 'a' as const, n: '11', name: 'A', short: 'A', color: '#000' },
  { key: 'b' as const, n: '22', name: 'B', short: 'B', color: '#fff' },
];

function snap(over: Partial<Snap>): Snap {
  return {
    s: 'br', at: '', pst: 50, a: 0, b: 0, pa: 0, pb: 0, valid: 0, blank: 0, nulls: 0, el: 0, elc: 0,
    turnout: 0, status: 'apurando', lead: null, need: null, rem: 0, rmax: 0, ...over,
  };
}

test('toSnap: definido só quando a vantagem supera o eleitorado restante', () => {
  const base = {
    scope: 'br' as const, code: 'br', round: 2 as const, election: '6258', at: '', totalized: false,
    sections: { total: 10, counted: 9 }, pst: 90, el: 1000, elc: 900, turnout: 700, abst: 200, valid: 680,
    blank: 10, nulls: 10, names: {},
  };
  const close = toSnap({ ...base, votes: { '11': 360, '22': 320 } }, cands);
  assert.equal(close.status, 'apurando');
  assert.equal(close.lead, 'a');
  assert.ok(close.need! > 50);
  const done = toSnap({ ...base, votes: { '11': 500, '22': 180 } }, cands);
  assert.equal(done.status, 'definido');
  assert.equal(done.need, null);
});

const h = (a: number, b: number, extra = 0): HistRow => ({
  el: 1000, turnout: 800, abst: 200, valid: a + b + extra, blank: 20, nulls: 30, votes: { '11': a, '22': b, '99': extra },
});

test('transfer: ganho sobre o estoque do 1º turno', () => {
  const now = snap({ a: 450, b: 350, el: 1000, elc: 1000, turnout: 820 });
  const t = transfer(now, h(400, 300, 50), cands);
  assert.equal(t.gainA, 50);
  assert.equal(t.gainB, 50);
  // 50 eliminados + 50 brancos/nulos + (200 - 180) abstenção = 120
  assert.equal(t.stock, 120);
});

test('flipped vs 2022', () => {
  const now = snap({ lead: 'a' });
  assert.deepEqual(flipped(now, h(100, 200), { a: '11', b: '22' }), { from: 'b', to: 'a' });
  assert.equal(flipped(now, h(300, 200), { a: '11', b: '22' }), null);
});

test('project devolve intervalo e respeita o mínimo apurado', () => {
  const ufs = {
    'uf:SP': snap({ s: 'uf:SP', pst: 60, a: 600, b: 400, pa: 60, pb: 40, valid: 1000, rem: 600 }),
    'uf:BA': snap({ s: 'uf:BA', pst: 30, a: 200, b: 300, pa: 40, pb: 60, valid: 500, rem: 1000 }),
  };
  const br = snap({ pst: 45, a: 800, b: 700, pa: 53.33, pb: 46.67, valid: 1500 });
  const hist = { SP: h(550, 450), BA: h(380, 620) };
  const p = project(br, ufs, hist, cands)!;
  assert.ok(p.lo < p.pa && p.pa < p.hi);
  assert.equal(project({ ...br, pst: 10 }, ufs, hist, cands), null);
});

test('detectMoments: marcos, viradas e ids determinísticos', () => {
  const prevBr = snap({ pst: 8, lead: 'a', pa: 51, pb: 49 });
  const br = snap({ pst: 26, lead: 'b', pa: 49.5, pb: 50.5 });
  const m = detectMoments({
    cands, prevBr, br,
    prevUfs: { 'uf:BA': snap({ pst: 40, lead: 'a' }) },
    ufs: { 'uf:BA': snap({ pst: 55, lead: 'b' }) },
    now: '2026-10-25T18:00:00-03:00',
  });
  const ids = m.map((x) => x.id);
  assert.ok(ids.includes('milestone:br:10'));
  assert.ok(ids.includes('milestone:br:25'));
  assert.ok(ids.some((i) => i.startsWith('virada:br:b')));
  assert.ok(ids.includes('uf_milestone:BA:50'));
  assert.ok(ids.some((i) => i.startsWith('virada_uf:BA:b')));
});

test('moderação: termos, leet, links e tamanho', () => {
  const mod = new Moderator();
  assert.equal(mod.check('vai virar hein').ok, true);
  assert.equal(mod.check('que p0rrrra').ok, false);
  assert.equal(mod.check('entra no grupo wa.me/5511').ok, false);
  assert.equal(mod.check('veja site.com.br').ok, false);
  assert.equal(mod.check('x'.repeat(241)).ok, false);
  assert.equal(mod.check('   ').ok, false);
});
