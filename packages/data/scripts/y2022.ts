// 2022 (1º e 2º turno, presidente) a partir dos dados abertos do TSE → hist/y2022-t{1,2}*.json
// O zip de votação tem 580 MB e um CSV "BRASIL" de 4 GB: lemos em streaming só a entrada `_BR.csv`
// (que já contém só presidente) sem extrair nada em disco.
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import yauzl from 'yauzl';
import type { HistoryFile, HistRow, Municipality } from '@apuracao/shared';
import { MUN_FILE } from './municipalities';
import { download, isMain, RAW, readJson, STATIC, writeJson } from './lib';

const ODS = 'https://cdn.tse.jus.br/estatistica/sead/odsele';
const VOTES_ZIP = `${ODS}/votacao_candidato_munzona/votacao_candidato_munzona_2022.zip`;
const DETAIL_ZIP = `${ODS}/detalhe_votacao_munzona/detalhe_votacao_munzona_2022.zip`;

/** Totais oficiais do 2º turno 2022 (TSE) para validação */
const OFFICIAL_T2 = { '13': 60_345_999, '22': 58_206_354 };

function openEntry(zipPath: string, entryName: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) return reject(err);
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== entryName) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e);
          stream.on('end', () => zip.close());
          resolve(stream);
        });
      });
      zip.on('end', () => reject(new Error(`${entryName} não está em ${zipPath}`)));
      zip.readEntry();
    });
  });
}

export async function* rows(zipPath: string, entryName: string): AsyncGenerator<Record<string, string>> {
  const stream = await openEntry(zipPath, entryName);
  const parser = stream.pipe(
    parse({ delimiter: ';', columns: true, encoding: 'latin1', relax_quotes: true, skip_empty_lines: true }),
  );
  for await (const r of parser) yield r as Record<string, string>;
}

const empty = (): HistRow => ({ el: 0, turnout: 0, abst: 0, valid: 0, blank: 0, nulls: 0, votes: {} });
const int = (s: string | undefined) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

interface Acc {
  br: HistRow;
  uf: Record<string, HistRow>;
  mun: Record<string, Record<string, HistRow>>; // uf -> ibge -> row
}
const newAcc = (): Acc => ({ br: empty(), uf: {}, mun: {} });

export async function buildY2022() {
  const t0 = Date.now();
  const muns = readJson<Municipality[]>(MUN_FILE);
  const tseToIbge = new Map(muns.map((m) => [`${m.uf}:${m.tse}`, m.ibge]));
  const unmapped = new Map<string, string>();
  const keyOf = (uf: string, cd: string, name: string) => {
    const tse = cd.padStart(5, '0');
    const ibge = tseToIbge.get(`${uf}:${tse}`);
    if (ibge) return ibge;
    unmapped.set(`${uf}:${tse}`, name);
    return uf === 'ZZ' ? `zz${tse}` : `tse${tse}`;
  };
  const acc: Record<'1' | '2', Acc> = { '1': newAcc(), '2': newAcc() };
  const rowsFor = (turno: string, uf: string, ibge: string) => {
    const a = acc[turno as '1' | '2'];
    if (!a) return null;
    return [a.br, (a.uf[uf] ??= empty()), ((a.mun[uf] ??= {})[ibge] ??= empty())];
  };

  console.log('baixando zips de 2022 (cache em raw/)…');
  const votesZip = await download(VOTES_ZIP, join(RAW, 'votacao_candidato_munzona_2022.zip'));
  const detailZip = await download(DETAIL_ZIP, join(RAW, 'detalhe_votacao_munzona_2022.zip'));

  let n = 0;
  for await (const r of rows(votesZip, 'votacao_candidato_munzona_2022_BR.csv')) {
    if (r.CD_CARGO !== '1') continue;
    const targets = rowsFor(r.NR_TURNO, r.SG_UF, keyOf(r.SG_UF, r.CD_MUNICIPIO, r.NM_MUNICIPIO));
    if (!targets) continue;
    const v = int(r.QT_VOTOS_NOMINAIS_VALIDOS);
    for (const t of targets) t.votes[r.NR_CANDIDATO] = (t.votes[r.NR_CANDIDATO] ?? 0) + v;
    n++;
  }
  console.log(`  votação: ${n} linhas`);

  n = 0;
  for await (const r of rows(detailZip, 'detalhe_votacao_munzona_2022_BR.csv')) {
    if (r.CD_CARGO !== '1') continue;
    const targets = rowsFor(r.NR_TURNO, r.SG_UF, keyOf(r.SG_UF, r.CD_MUNICIPIO, r.NM_MUNICIPIO));
    if (!targets) continue;
    for (const t of targets) {
      t.el += int(r.QT_APTOS);
      t.turnout += int(r.QT_COMPARECIMENTO);
      t.abst += int(r.QT_ABSTENCOES);
      t.valid += int(r.QT_TOTAL_VOTOS_VALIDOS);
      t.blank += int(r.QT_VOTOS_BRANCOS);
      t.nulls += int(r.QT_TOTAL_VOTOS_NULOS);
    }
    n++;
  }
  console.log(`  detalhe: ${n} linhas`);

  const problems: string[] = [];
  for (const turno of ['1', '2'] as const) {
    const a = acc[turno];
    const sumVotes = Object.values(a.br.votes).reduce((s, x) => s + x, 0);
    if (sumVotes !== a.br.valid) problems.push(`T${turno}: soma dos votos ${sumVotes} ≠ válidos ${a.br.valid}`);
    const file: HistoryFile = { label: `${turno}º turno 2022`, year: 2022, round: turno === '1' ? 1 : 2, br: a.br, uf: a.uf, mun: {} };
    writeJson(join(STATIC, `hist/y2022-t${turno}.json`), file);
    for (const [uf, m] of Object.entries(a.mun)) writeJson(join(STATIC, `hist/y2022-t${turno}/${uf}.json`), m);
    console.log(
      `y2022-t${turno}: aptos ${a.br.el}, comparecimento ${a.br.turnout}, válidos ${a.br.valid}, brancos ${a.br.blank}, nulos ${a.br.nulls}`,
    );
  }
  const t2 = acc['2'].br.votes;
  for (const [num, want] of Object.entries(OFFICIAL_T2)) {
    if (t2[num] !== want) problems.push(`T2 ${num}: ${t2[num]} ≠ oficial ${want}`);
  }
  console.log(`T2 2022: 13 = ${t2['13']}, 22 = ${t2['22']}`);
  const unm = [...unmapped].filter(([k]) => !k.startsWith('ZZ:'));
  if (unm.length) problems.push(`${unm.length} municípios de 2022 sem de-para IBGE: ${unm.slice(0, 10).map(([k, v]) => `${k} ${v}`)}`);
  const zz = [...unmapped].filter(([k]) => k.startsWith('ZZ:')).length;
  if (zz) console.log(`  (${zz} cidades do exterior de 2022 sem par em 2026 — chave zz<tse>)`);
  console.log(problems.length ? `⚠ ${problems.join('\n⚠ ')}` : '✔ 2022: totais oficiais do 2º turno batem, junção IBGE 100% (Brasil)');
  console.log(`y2022 em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return { problems };
}

if (isMain(import.meta.url)) await buildY2022();
