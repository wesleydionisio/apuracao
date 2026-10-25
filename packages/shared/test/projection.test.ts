import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildProjModel,
  emptyLearn,
  expit,
  logit,
  normCdf,
  projectByCity,
  updateLearn,
  type HistRow,
  type ProjAreaInput,
  type ProjObs,
} from '../src/index';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

const row = (el: number, a: number, b: number, other: number): HistRow => {
  const turnout = Math.round(el * 0.8);
  const valid = a + b + other;
  return { el, turnout, abst: el - turnout, valid, blank: Math.round((turnout - valid) / 2), nulls: turnout - valid - Math.round((turnout - valid) / 2), votes: { '13': a, '22': b, '99': other } };
};

/**
 * Mundo sintético: 3 UFs × 150 cidades. No 2º turno cada cidade vota logit(1º turno) + 0,15 (Brasil) + efeito da UF
 * + ruído da cidade. As cidades chegam em ordem enviesada: a UF "NE" (mais pró-A) chega por último.
 */
function world(seed = 1) {
  const r = rng(seed);
  const ufs = ['SP', 'PR', 'BA'];
  const ufEff: Record<string, number> = { SP: -0.05, PR: 0.02, BA: 0.08 };
  const cities: { input: ProjAreaInput; truthA: number; truthB: number; order: number; tr: number }[] = [];
  for (const uf of ufs) {
    const lean = uf === 'BA' ? 0.9 : uf === 'SP' ? -0.2 : -0.5;
    for (let k = 0; k < 150; k++) {
      const el = Math.round(2000 + 200000 * r() ** 4);
      const x1 = lean + 0.6 * gauss(r);
      const p1 = expit(x1);
      const valid1 = Math.round(el * 0.8 * 0.93);
      const other = Math.round(valid1 * 0.08);
      const a1 = Math.round((valid1 - other) * p1);
      const b1 = valid1 - other - a1;
      const p2 = expit(x1 + 0.15 + ufEff[uf] + 0.05 * gauss(r));
      const v2 = Math.round(el * 0.78 * 0.95);
      const truthA = Math.round(v2 * p2);
      cities.push({
        input: { id: `${uf}${k}`, uf, el, base: row(el, a1, b1, other), lat: -20 + r() * 5, lon: -50 + r() * 5 },
        truthA,
        truthB: v2 - truthA,
        order: (uf === 'BA' ? 0.6 : 0) + r() * 0.6,
        tr: 0.78,
      });
    }
  }
  return cities;
}

/** observações e totais quando as cidades com ordem < t já foram contadas (inteiras) */
function night(cities: ReturnType<typeof world>, t: number) {
  const model = buildProjModel(cities.map((c) => c.input), { a: '13', b: '22' });
  const obs: (ProjObs | null)[] = model.areas.map(() => null);
  const br = { a: 0, b: 0, el: 0, elc: 0 };
  const ufs: Record<string, typeof br> = {};
  for (const c of cities) {
    const i = model.index.get(c.input.id)!;
    const u = (ufs[c.input.uf] ??= { a: 0, b: 0, el: 0, elc: 0 });
    for (const x of [br, u]) x.el += c.input.el;
    if (c.order < t) {
      obs[i] = { elc: c.input.el, turnout: Math.round(c.input.el * c.tr), snap: { a: c.truthA, b: c.truthB, turnout: Math.round(c.input.el * c.tr), elc: c.input.el } };
      for (const x of [br, u]) {
        x.a += c.truthA;
        x.b += c.truthB;
        x.elc += c.input.el;
      }
    }
  }
  const truth = (cities.reduce((s, c) => s + c.truthA, 0) / cities.reduce((s, c) => s + c.truthA + c.truthB, 0)) * 100;
  return { model, obs, br, ufs, truth, pst: (br.elc / br.el) * 100 };
}

test('projeção por cidade: corrige a ordem enviesada e a faixa contém o resultado', () => {
  const cities = world(7);
  for (const t of [0.3, 0.6, 0.9]) {
    const { model, obs, br, ufs, truth, pst } = night(cities, t);
    const r = projectByCity(model, { br, ufs, obs, pst })!;
    const partial = (br.a / (br.a + br.b)) * 100;
    assert.ok(r.lo <= truth && truth <= r.hi, `t=${t}: ${truth.toFixed(2)} fora de [${r.lo}, ${r.hi}]`);
    assert.ok(Math.abs(r.pa - truth) < Math.abs(partial - truth), `t=${t}: projeção não melhora o parcial`);
    assert.ok(r.pWin >= 0 && r.pWin <= 1);
    // a UF que ainda não começou ganha projeção pela estrutura (1º turno + efeitos), com faixa larga
    if (t < 0.6) assert.ok(r.ufs.BA.hi - r.ufs.BA.lo > r.ufs.SP.hi - r.ufs.SP.lo);
  }
});

test('projeção por cidade: sem voto nenhum não projeta; tudo apurado = resultado exato', () => {
  const cities = world(3);
  const none = night(cities, -1);
  assert.equal(projectByCity(none.model, { br: none.br, ufs: none.ufs, obs: none.obs, pst: 0 }), null);
  const all = night(cities, 99);
  const r = projectByCity(all.model, { br: all.br, ufs: all.ufs, obs: all.obs, pst: 100 })!;
  assert.equal(r.pa, Math.round(all.truth * 100) / 100);
  assert.equal(r.lo, r.hi);
});

test('aprendizado: deriva média das primeiras seções vem dos passos dos parciais', () => {
  const cities = world(5);
  const model = buildProjModel(cities.map((c) => c.input), { a: '13', b: '22' });
  const learn = emptyLearn();
  const bias = 0.2; // as primeiras seções puxam 0,2 (logit) para A, sumindo conforme a cidade fecha
  for (const f of [0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
    const obs: (ProjObs | null)[] = cities.map((c) => {
      const p = expit(logit(c.truthA / (c.truthA + c.truthB)) + bias * (1 - f));
      const v = (c.truthA + c.truthB) * f;
      return { elc: c.input.el * f, turnout: c.input.el * 0.78 * f, snap: { a: v * p, b: v * (1 - p), turnout: c.input.el * 0.78 * f, elc: c.input.el * f } };
    });
    updateLearn(learn, model, obs, null);
  }
  assert.ok(learn.drift.length > 300, 'pares parcial→final');
  assert.ok((learn.steps?.length ?? 0) > 1000, 'passos entre retratos');
  const one = cities.map((c) => ({ elc: c.input.el, turnout: c.input.el * 0.78, snap: { a: c.truthA, b: c.truthB, turnout: c.input.el * 0.78, elc: c.input.el } }));
  const r2 = projectByCity(model, { br: { a: 100, b: 100, el: 1000, elc: 500 }, obs: one, pst: 50, learn })!;
  assert.ok(Math.abs(r2.diag.driftMean - bias) < 0.03, `deriva aprendida ${r2.diag.driftMean}`);
});

test('autoavaliação: previsão congelada quando a cidade aparece e conferida com 60%+', () => {
  const cities = world(9);
  const model = buildProjModel(cities.map((c) => c.input), { a: '13', b: '22' });
  const learn = emptyLearn();
  const id = model.areas[0].id;
  const pending = new Map([[0, [0.1, 0.01, 50] as [number, number, number]]]);
  updateLearn(learn, model, model.areas.map(() => null), { pending } as never);
  assert.deepEqual(learn.pred[id], [0.1, 0.01, 50]);
  const c = cities.find((x) => x.input.id === id)!;
  const at = (f: number) => model.areas.map((_, i) => (i ? null : { elc: c.input.el * f, turnout: 0, snap: { a: c.truthA * f, b: c.truthB * f, turnout: 1, elc: c.input.el * f } }));
  updateLearn(learn, model, at(0.2), { pending: new Map([[0, [9, 9, 9]]]) } as never);
  assert.deepEqual(learn.pred[id], [0.1, 0.01, 50], 'congelada: não aceita previsão nova depois que a cidade apareceu');
  assert.equal(learn.errs.length, 0);
  updateLearn(learn, model, at(0.7), null);
  assert.equal(learn.errs.length, 1);
  assert.equal(learn.pred[id], undefined);
});

test('normCdf', () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-4);
  assert.ok(Math.abs(normCdf(-1.96) - 0.025) < 1e-4);
});
