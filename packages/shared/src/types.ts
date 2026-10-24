// Tipos compartilhados entre poller, ws, api e web.
// Tudo é candidato-agnóstico: "a" e "b" são definidos em CandidateDef.

export type Side = 'a' | 'b';

export interface CandidateDef {
  key: Side;
  /** número na urna, ex.: "13" */
  n: string;
  /** nome de urna, ex.: "FULANO" */
  name: string;
  /** nome curto para cards e chat */
  short: string;
  color: string;
  /** foto oficial do TSE (caminho público no site), se baixada pelo ETL */
  photo?: string;
  /** partido/federação, ex.: "PT" */
  party?: string;
}

export type ElectionStatus =
  | 'nao_iniciada'
  | 'apurando'
  | 'definido' // matematicamente definido (votos restantes não permitem virada)
  | 'totalizado'; // TSE marcou totalização final

/** Escopo: 'br' | 'uf:SP' | 'mun:3550308' (código IBGE) */
export type ScopeKey = string;

/** Resultado normalizado de um JSON do TSE (qualquer escopo, qualquer turno). */
export interface ParsedResult {
  scope: 'br' | 'uf' | 'mun';
  /** 'br', 'SP', ou código TSE do município (5 dígitos) */
  code: string;
  round: 1 | 2;
  election: string;
  /** hora da última totalização (ou geração do arquivo), ISO com -03:00 */
  at: string;
  totalized: boolean;
  sections: { total: number; counted: number };
  /** % de seções totalizadas, 0–100 */
  pst: number;
  /** eleitorado total do escopo */
  el: number;
  /** eleitorado das seções já totalizadas */
  elc: number;
  /** comparecimento (nas seções totalizadas) */
  turnout: number;
  abst: number;
  valid: number;
  blank: number;
  nulls: number;
  /** votos por número de candidato */
  votes: Record<string, number>;
  names: Record<string, { name: string; full: string; seq: number; sq?: string; party?: string }>;
}

/** Snapshot compacto que vai para o cliente (JSON estático e WS). */
export interface Snap {
  s: ScopeKey;
  at: string;
  pst: number;
  a: number;
  b: number;
  /** % de votos válidos de A e B (0–100) */
  pa: number;
  pb: number;
  valid: number;
  blank: number;
  nulls: number;
  el: number;
  elc: number;
  turnout: number;
  status: ElectionStatus;
  lead: Side | null;
  /** % dos votos válidos restantes que o candidato atrás precisa para virar (0–100+), null se não se aplica */
  need: number | null;
  /** estimativa de votos válidos restantes */
  rem: number;
  /** teto absoluto de votos restantes (eleitorado não apurado) */
  rmax: number;
}

export interface CurvePoint {
  pst: number;
  pa: number;
  at?: string;
}

export interface Projection {
  /** estimativa de % final de A, com intervalo */
  pa: number;
  lo: number;
  hi: number;
  basedOnPst: number;
}

export interface RemainingRow {
  uf: string;
  pst: number;
  /** votos válidos estimados que faltam na UF */
  rem: number;
  /** % de A entre A+B no 1º turno (dois candidatos) na UF */
  pa1: number | null;
  /** % de A no parcial atual */
  pa: number | null;
}

export interface Moment {
  id: string;
  kind:
    | 'milestone'
    | 'virada'
    | 'uf_milestone'
    | 'virada_uf'
    | 'definido'
    | 'totalizado'
    | 'mun_final'
    | 'mun_flip';
  scope: ScopeKey;
  title: string;
  payload?: Record<string, unknown>;
  at: string;
}

export interface Flags {
  chat: boolean;
  projection: boolean;
  map_mun: boolean;
}

/** /data/br.json — o placar inteiro, regravado a cada ciclo do poller */
export interface Board {
  v: number;
  generatedAt: string;
  /** false enquanto está antes do horário de divulgação (17h de Brasília) */
  released: boolean;
  releaseAt: string;
  source: { name: 'TSE'; url: string; at: string | null };
  candidates: CandidateDef[];
  /** número de cada lado na eleição de 2022 (para "virou de lado" e curva comparada) */
  y2022Map: Record<Side, string>;
  flags: Flags;
  br: Snap | null;
  ufs: Record<string, Snap>;
  remaining: RemainingRow[];
  projection: Projection | null;
  curve: CurvePoint[];
  moments: Moment[];
}

/** /data/mun/<UF>.json */
export interface MunBoard {
  generatedAt: string;
  uf: string;
  /** chave = código IBGE */
  mun: Record<string, Snap>;
}

/** Histórico compacto por escopo (1º turno 2026, 2022) */
export interface HistRow {
  el: number;
  turnout: number;
  abst: number;
  valid: number;
  blank: number;
  nulls: number;
  votes: Record<string, number>;
}

export interface HistoryFile {
  label: string;
  year: number;
  round: 1 | 2;
  br: HistRow | null;
  uf: Record<string, HistRow>;
  /** chave = código IBGE */
  mun: Record<string, HistRow>;
}

export interface Municipality {
  ibge: string;
  tse: string;
  name: string;
  uf: string;
  slug: string;
  el: number;
}

export interface Guess {
  id: string;
  nick: string;
  pa: number;
  uf: string | null;
  ufPa: number | null;
  mun: string | null;
  munPa: number | null;
  createdAt: string;
  /** muda a cada ajuste: versiona a URL do card (a CDN não serve o antigo) */
  updatedAt?: string;
}
