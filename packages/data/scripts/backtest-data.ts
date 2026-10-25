// Base do backtest da projeção: votos e comparecimento por ZONA de cada cidade (1º e 2º turno de presidente),
// com a hora em que cada zona terminou de totalizar na noite real. Os dados abertos do TSE trazem essa hora
// (DT/HH_ULTIMA_TOTALIZACAO) em 2018, 2022 e 2026; 2010 e 2014 só servem de "eleição anterior".
// Uso: npx tsx scripts/backtest-data.ts [anos…]   (padrão: 2010 2014 2018 2022 2026)
// Saída: raw/backtest/y<ano>.json (fora do git; só o backtest lê). Zips em cache em raw/ (~2 GB no total).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Municipality } from '@apuracao/shared';
import { MUN_FILE } from './municipalities';
import { download, isMain, RAW, readJson, writeJson } from './lib';
import { rows } from './y2022';

const ODS = 'https://cdn.tse.jus.br/estatistica/sead/odsele';

/** uma zona de uma cidade num turno */
export interface BtZone {
  /** id da cidade (IBGE; exterior: zz<tse>) */
  id: string;
  uf: string;
  zone: string;
  el: number;
  turnout: number;
  valid: number;
  blank: number;
  nulls: number;
  /** minutos depois das 17h do dia do turno em que a zona terminou de totalizar (null = sem hora) */
  at: number | null;
  votes: Record<string, number>;
}

export interface BtYear {
  year: number;
  /** dia de cada turno (dd/mm/aaaa) */
  dates: Record<'1' | '2', string>;
  zones: Record<'1' | '2', BtZone[]>;
}

const int = (s: string | undefined) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

function minutesAfter17(date: string, d?: string, h?: string): number | null {
  if (!d || !h || !/^\d{2}\/\d{2}\/\d{4}$/.test(d) || !/^\d{2}:\d{2}/.test(h)) return null;
  const iso = (x: string, hh: string) => `${x.slice(6)}-${x.slice(3, 5)}-${x.slice(0, 2)}T${hh}-03:00`;
  const t = (Date.parse(iso(d, h.length === 5 ? `${h}:00` : h)) - Date.parse(iso(date, '17:00:00'))) / 60000;
  // hora de reprocessamento (anos depois) ou 00:00 de preenchimento não é a hora da noite
  return Number.isFinite(t) && t > -120 && t < 24 * 60 && !(h.startsWith('00:00')) ? Math.round(t * 10) / 10 : null;
}

export async function buildBacktestYear(year: number): Promise<BtYear> {
  const t0 = Date.now();
  const muns = readJson<Municipality[]>(MUN_FILE);
  const tseToId = new Map(muns.map((m) => [`${m.uf}:${m.tse}`, m.ibge]));
  const idOf = (uf: string, cd: string) => {
    const tse = cd.padStart(5, '0');
    return tseToId.get(`${uf}:${tse}`) ?? (uf === 'ZZ' ? `zz${tse}` : `tse${tse}`);
  };
  const votesZip = await download(
    `${ODS}/votacao_candidato_munzona/votacao_candidato_munzona_${year}.zip`,
    join(RAW, `votacao_candidato_munzona_${year}.zip`),
  );
  const detailZip = await download(
    `${ODS}/detalhe_votacao_munzona/detalhe_votacao_munzona_${year}.zip`,
    join(RAW, `detalhe_votacao_munzona_${year}.zip`),
  );

  const zones: Record<string, BtZone> = {};
  const dates: Record<string, string> = {};
  const zoneOf = (r: Record<string, string>) => {
    const turno = r.NR_TURNO;
    if (turno !== '1' && turno !== '2') return null;
    // os dois arquivos às vezes divergem nos zeros à esquerda do município e da zona
    const key = `${turno}|${r.SG_UF}|${r.CD_MUNICIPIO.padStart(5, '0')}|${Number(r.NR_ZONA)}`;
    return (zones[key] ??= {
      id: idOf(r.SG_UF, r.CD_MUNICIPIO),
      uf: r.SG_UF,
      zone: r.NR_ZONA,
      el: 0,
      turnout: 0,
      valid: 0,
      blank: 0,
      nulls: 0,
      at: null,
      votes: {},
    });
  };

  for await (const r of rows(votesZip, `votacao_candidato_munzona_${year}_BR.csv`)) {
    if (r.CD_CARGO !== '1') continue;
    const z = zoneOf(r);
    if (!z) continue;
    const v = int(r.QT_VOTOS_NOMINAIS_VALIDOS ?? r.QT_VOTOS_NOMINAIS);
    z.votes[r.NR_CANDIDATO] = (z.votes[r.NR_CANDIDATO] ?? 0) + v;
  }
  for await (const r of rows(detailZip, `detalhe_votacao_munzona_${year}_BR.csv`)) {
    if (r.CD_CARGO !== '1') continue;
    const z = zoneOf(r);
    if (!z) continue;
    if (r.DT_ELEICAO) dates[r.NR_TURNO] = r.DT_ELEICAO;
    z.el += int(r.QT_APTOS);
    z.turnout += int(r.QT_COMPARECIMENTO);
    z.valid += int(r.QT_TOTAL_VOTOS_VALIDOS ?? r.QT_VOTOS_NOMINAIS);
    z.blank += int(r.QT_VOTOS_BRANCOS);
    z.nulls += int(r.QT_TOTAL_VOTOS_NULOS ?? r.QT_VOTOS_NULOS);
    const at = minutesAfter17(r.DT_ELEICAO, r.DT_ULTIMA_TOTALIZACAO, r.HH_ULTIMA_TOTALIZACAO);
    // voto em trânsito vem em linha separada da mesma zona: vale a hora mais tarde
    if (at !== null) z.at = z.at === null ? at : Math.max(z.at, at);
  }

  const out: BtYear = { year, dates: { '1': dates['1'] ?? '', '2': dates['2'] ?? '' }, zones: { '1': [], '2': [] } };
  for (const [key, z] of Object.entries(zones)) {
    // valid = soma dos nominais (o detalhe às vezes conta legenda/anulados de outro jeito)
    z.valid = Object.values(z.votes).reduce((s, x) => s + x, 0);
    out.zones[key[0] as '1' | '2'].push(z);
  }
  for (const t of ['1', '2'] as const) {
    const zs = out.zones[t];
    const timed = zs.filter((z) => z.at !== null).length;
    const tot: Record<string, number> = {};
    for (const z of zs) for (const [n, v] of Object.entries(z.votes)) tot[n] = (tot[n] ?? 0) + v;
    const top = Object.entries(tot)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([n, v]) => `${n}=${v}`)
      .join(' ');
    console.log(`  ${year} T${t}: ${zs.length} zonas (${timed} com hora), ${top}`);
  }
  writeJson(join(RAW, `backtest/y${year}.json`), out);
  console.log(`  y${year}.json em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return out;
}

export const btFile = (year: number) => join(RAW, `backtest/y${year}.json`);
export const loadBtYear = (year: number): BtYear | null => (existsSync(btFile(year)) ? readJson<BtYear>(btFile(year)) : null);

if (isMain(import.meta.url)) {
  const years = process.argv.slice(2).map(Number).filter(Boolean);
  for (const y of years.length ? years : [2010, 2014, 2018, 2022, 2026]) await buildBacktestYear(y);
}
