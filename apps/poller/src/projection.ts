// Projeção por cidade no poller: o modelo é montado uma vez (histórico + vizinhança das malhas IBGE)
// e roda a cada ciclo em board.ts (`projectionStep`). Sem histórico, fica null e vale o modelo por UF.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { buildProjModel, CAPITALS, centroidsOf, type CandidateDef, type ProjModel, type Side } from '@apuracao/shared';
import { readJson, type History } from './history';

export function buildPollerModel(hist: History, cands: CandidateDef[], y2022Map: Record<Side, string>, geoDir: string): ProjModel | null {
  if (!hist.municipalities.length || !Object.keys(hist.t1Mun).length) return null;
  const geo: Record<string, { lat: number; lon: number }> = {};
  if (existsSync(geoDir)) {
    for (const f of readdirSync(geoDir)) {
      const fc = readJson<Parameters<typeof centroidsOf>[0]>(path.join(geoDir, f));
      if (fc) Object.assign(geo, centroidsOf(fc));
    }
  }
  const t0 = Date.now();
  const model = buildProjModel(
    hist.municipalities.map((m) => ({
      id: m.ibge,
      uf: m.uf,
      el: m.el,
      base: hist.t1Mun[m.ibge] ?? null,
      prev: hist.y22t2Mun[m.ibge] ?? null,
      prevT1: hist.y22t1Mun[m.ibge] ?? null,
      lat: geo[m.ibge]?.lat,
      lon: geo[m.ibge]?.lon,
      capital: CAPITALS.has(m.ibge),
    })),
    { a: cands[0].n, b: cands[1].n, prevA: y2022Map.a, prevB: y2022Map.b },
    hist.t1?.uf ?? {},
  );
  const withNb = model.areas.filter((a) => a.nb.length).length;
  console.log(`[projeção] modelo por cidade: ${model.areas.length} áreas, ${withNb} com vizinhos, ${Date.now() - t0} ms`);
  return model.areas.length ? model : null;
}
