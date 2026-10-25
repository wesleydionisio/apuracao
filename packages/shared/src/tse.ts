// Parser tolerante dos JSONs de resultados do TSE (formato 2026: /oficial/ele2026/<ele>/dados/<uf>/...-u.json).
// Campos ausentes viram 0 em vez de quebrar o ciclo do poller.
import type { CandidateDef, ParsedResult } from './types';

export const TSE_BASE = 'https://resultados.tse.jus.br/oficial';

export interface TseElection {
  cycle: string; // 'ele2026'
  code: string; // '6258'
}

const pad6 = (code: string) => code.padStart(6, '0');

export const tsePaths = {
  /** resultado de presidente (cargo 0001) em br, uf ou município */
  result: (e: TseElection, uf: string, munTse?: string) =>
    `${e.cycle}/${e.code}/dados/${uf}/${uf}${munTse ?? ''}-c0001-e${pad6(e.code)}-u.json`,
  /** andamento de todas as UFs num arquivo só */
  progress: (e: TseElection) => `${e.cycle}/${e.code}/dados/br/br-e${pad6(e.code)}-ab.json`,
  /** andamento de todas as cidades de uma UF (% apurado por município, sem votos) */
  progressUf: (e: TseElection, uf: string) => `${e.cycle}/${e.code}/dados/${uf}/${uf}-e${pad6(e.code)}-ab.json`,
  /** lista de municípios com código TSE (cd) e IBGE (cdi) */
  municipalities: (e: TseElection) => `${e.cycle}/${e.code}/config/mun-e${pad6(e.code)}-cm.json`,
};

/** "47,027772356" | "56104503" | undefined -> number */
export function num(v: unknown): number {
  if (v === undefined || v === null || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** percentuais vêm com vírgula decimal e sem separador de milhar */
function pct(v: unknown): number {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** "05/10/2026" + "12:51:05" -> "2026-10-05T12:51:05-03:00" */
export function tseDate(d?: string, h?: string, tz = '-03:00'): string | null {
  if (!d) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d.trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}T${(h || '00:00:00').trim()}${tz}`;
}

/** o TSE grava dt/ht (hora da totalização) na hora local do lugar; dg/hg (geração do arquivo) é sempre a de Brasília */
const UF_TZ: Record<string, string> = { AC: '-05:00', AM: '-04:00', MS: '-04:00', MT: '-04:00', RO: '-04:00', RR: '-04:00' };
/** cidades fora do fuso da UF ("UF:código TSE"), conferidas nos horários do TSE na noite do 2º turno */
const MUN_TZ: Record<string, string> = {
  // oeste do Amazonas, em UTC-5 como o Acre
  'AM:02917': '-05:00', // Amaturá
  'AM:02054': '-05:00', // Atalaia do Norte
  'AM:02135': '-05:00', // Benjamin Constant
  'AM:02291': '-05:00', // Eirunepé
  'AM:02313': '-05:00', // Envira
  'AM:02020': '-05:00', // Guajará
  'AM:02399': '-05:00', // Ipixuna
  'AM:98370': '-05:00', // Itamarati
  'AM:02755': '-05:00', // São Paulo de Olivença
  'AM:98477': '-05:00', // Tabatinga
  'PE:30015': '-02:00', // Fernando de Noronha
};

/** fuso do dt/ht de um arquivo do TSE. As cidades do exterior vêm no fuso de cada país e ficam
 *  marcadas como Brasília (a hora delas não aparece em tela; o arquivo do exterior inteiro vem em Brasília). */
export function tseTz(uf: string, munTse?: string): string {
  const UF = uf.toUpperCase();
  return (munTse && MUN_TZ[`${UF}:${munTse}`]) || UF_TZ[UF] || '-03:00';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function* candidatesOf(raw: Any): Generator<[Any, string]> {
  for (const carg of raw?.carg ?? []) {
    for (const agr of carg?.agr ?? []) {
      for (const par of agr?.par ?? []) {
        for (const cand of par?.cand ?? []) yield [cand, String(par?.sg ?? '')];
      }
    }
  }
}

/** cores fixas por número de urna; o resto cai no par padrão */
export const DEFAULT_CAND_COLORS: Record<string, string> = {
  '13': '#f2202e', // vermelho vivo
  '22': '#1f6fff', // azul vivo
};

/** "13:#f2202e,22:#1f6fff" -> mapa */
export function parseColorMap(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (s ?? '').split(',')) {
    const [n, c] = part.split(':').map((x) => x.trim());
    if (n && /^#[0-9a-f]{6}$/i.test(c ?? '')) out[n] = c;
  }
  return out;
}

/** `uf`: UF do arquivo, para o fuso da hora de um município (o de UF já diz a própria UF) */
export function parseResult(raw: Any, uf?: string): ParsedResult {
  if (!raw || typeof raw !== 'object') throw new Error('TSE: JSON vazio');
  const tpabr = String(raw.tpabr ?? '').toLowerCase();
  const scope: ParsedResult['scope'] = tpabr === 'mu' ? 'mun' : tpabr === 'uf' ? 'uf' : 'br';
  const tz = scope === 'br' ? '-03:00' : scope === 'uf' ? tseTz(String(raw.cdabr)) : tseTz(uf ?? '', String(raw.cdabr));
  const votes: ParsedResult['votes'] = {};
  const names: ParsedResult['names'] = {};
  for (const [c, party] of candidatesOf(raw)) {
    const n = String(c.n);
    votes[n] = num(c.vap);
    names[n] = {
      name: String(c.nmu ?? c.nm ?? n),
      full: String(c.nm ?? ''),
      seq: num(c.seq),
      sq: c.sqcand ? String(c.sqcand) : undefined,
      party: party || undefined,
    };
  }
  const s = raw.s ?? {};
  const e = raw.e ?? {};
  const v = raw.v ?? {};
  return {
    scope,
    code: scope === 'br' ? 'br' : scope === 'uf' ? String(raw.cdabr).toUpperCase() : String(raw.cdabr),
    round: String(raw.t) === '2' ? 2 : 1,
    election: String(raw.ele ?? ''),
    at: tseDate(raw.dt, raw.ht, tz) ?? tseDate(raw.dg, raw.hg) ?? new Date().toISOString(),
    totalized: raw.tf === 's',
    sections: { total: num(s.ts), counted: num(s.st) },
    pst: pct(s.pstn ?? s.pst),
    el: num(e.te),
    elc: num(e.est),
    turnout: num(e.c),
    abst: num(e.a),
    valid: num(v.vv),
    blank: num(v.vb),
    nulls: num(v.tvn ?? v.vn),
    votes,
    names,
  };
}

export interface ProgressRow {
  uf: string;
  pst: number;
  el: number;
  elc: number;
  turnout: number;
  at: string | null;
}

/** br-e<ele>-ab.json: andamento por UF */
export function parseProgress(raw: Any): ProgressRow[] {
  return (raw?.abr ?? []).map((r: Any) => ({
    uf: String(r.cdabr).toUpperCase(),
    pst: pct(r.s?.pstn ?? r.s?.pst),
    el: num(r.e?.te),
    elc: num(r.e?.est),
    turnout: num(r.e?.c),
    at: tseDate(r.dt, r.ht, tseTz(String(r.cdabr))),
  }));
}

export interface MunProgress {
  /** código TSE do município */
  tse: string;
  pst: number;
  el: number;
  elc: number;
  /** comparecimento nas seções já totalizadas */
  turnout: number;
  /** hora da última totalização daquela cidade (muda quando entra seção nova) */
  at: string | null;
}

/** <uf>-e<ele>-ab.json: andamento de cada município da UF (`uf` dá o fuso da hora de cada cidade) */
export function parseMunProgress(raw: Any, uf = ''): MunProgress[] {
  return (raw?.abr ?? [])
    .filter((r: Any) => String(r.tpabr).toLowerCase().startsWith('mu'))
    .map((r: Any) => ({
      tse: String(r.cdabr),
      pst: pct(r.s?.pstn ?? r.s?.pst),
      el: num(r.e?.te),
      elc: num(r.e?.est),
      turnout: num(r.e?.c),
      at: tseDate(r.dt, r.ht, tseTz(uf, String(r.cdabr))),
    }));
}

export interface TseMunicipality {
  uf: string;
  tse: string;
  ibge: string;
  name: string;
  capital: boolean;
}

export function parseMunicipalities(raw: Any): TseMunicipality[] {
  const out: TseMunicipality[] = [];
  for (const abr of raw?.abr ?? []) {
    for (const mu of abr?.mu ?? []) {
      out.push({
        uf: String(abr.cd).toUpperCase(),
        tse: String(mu.cd),
        ibge: String(mu.cdi ?? ''),
        name: String(mu.nm),
        capital: mu.c === 's',
      });
    }
  }
  return out;
}

/**
 * Define A e B a partir do arquivo BR do 2º turno.
 * Preferência: números passados explicitamente (env CAND_A / CAND_B); senão a ordem `seq` do TSE.
 */
export function detectCandidates(
  br: ParsedResult,
  opts: { a?: string; b?: string; colors?: [string, string]; colorByNum?: Record<string, string>; photo?: (n: string) => string | undefined } = {},
): CandidateDef[] {
  const nums = Object.keys(br.names).sort((x, y) => br.names[x].seq - br.names[y].seq);
  const na = opts.a ?? nums[0];
  const nb = opts.b ?? nums.find((n) => n !== na);
  if (!na || !nb) throw new Error('TSE: não encontrei dois candidatos no arquivo do 2º turno');
  const [ca, cb] = opts.colors ?? ['#1f6fff', '#f2202e'];
  const byNum = { ...DEFAULT_CAND_COLORS, ...opts.colorByNum };
  const def = (key: 'a' | 'b', n: string, fallback: string): CandidateDef => ({
    key,
    n,
    name: br.names[n]?.name ?? n,
    short: titleCase(br.names[n]?.name ?? n),
    color: byNum[n] ?? fallback,
    photo: opts.photo?.(n),
    party: br.names[n]?.party,
  });
  return [def('a', na, ca), def('b', nb, cb)];
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) =>
      i > 0 && ['da', 'de', 'do', 'das', 'dos', 'e'].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(' ');
}
