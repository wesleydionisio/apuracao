// Poller singleton: TSE (ou replay) → normaliza → JSON estático + Redis + Postgres.
// Ciclo de ~12s com jitter, backoff exponencial em erro, grava só quando o conteúdo muda.
import { createServer } from 'node:http';
import path from 'node:path';
import {
  detectCandidates,
  isReleased,
  parseResult,
  tsePaths,
  TSE_UFS,
  type CandidateDef,
  type ParsedResult,
  type Side,
} from '@apuracao/shared';
import { emptyState, runCycle, toBoard, type PollState } from './board';
import { config } from './config';
import { loadHistory } from './history';
import { hashOf, loadState, Output, writeJsonAtomic } from './output';
import { ReplaySource } from './replay';
import { pool, TseSource, type Source } from './source';

const hist = loadHistory(config.staticDir);
const source: Source = config.source === 'replay' ? new ReplaySource(config, hist) : new TseSource(config);
const out = new Output(config);
const election = { cycle: config.tse.cycle, code: config.tse.code };
const stateFile = path.join(config.varDir, `poller-state-${config.source}.json`);

let state: PollState = loadState(stateFile) ?? emptyState();
let cands: CandidateDef[] | null = null;
let y2022Map: Record<Side, string> | null = null;
let lastBoardHash = '';
let munCursor = 0;
const health = { startedAt: new Date().toISOString(), lastOk: 0, lastChange: 0, errors: 0, consecutiveErrors: 0, lastError: '' };

/** municípios a coletar: os maiores por eleitorado (a lista vem do ETL) */
const munTargets = hist.municipalities
  .filter((m) => m.uf !== 'ZZ' && m.ibge)
  .sort((a, b) => b.el - a.el)
  .slice(0, config.munLimit);

async function fetchResult(uf: string, munTse?: string): Promise<ParsedResult | null> {
  const raw = await source.get(tsePaths.result(election, uf, munTse));
  return raw ? parseResult(raw) : null;
}

async function cycle() {
  const br = await fetchResult('br');
  if (!br) throw new Error('arquivo BR do 2º turno indisponível');
  if (!cands) {
    cands = detectCandidates(br, { a: config.cand.a, b: config.cand.b, colors: config.colors });
    y2022Map = { a: config.y2022.a ?? cands[0].n, b: config.y2022.b ?? cands[1].n };
    console.log(`[poller] A=${cands[0].n} ${cands[0].name} | B=${cands[1].n} ${cands[1].name}`);
  }

  const ufCodes = TSE_UFS;
  const ufRes = await pool(ufCodes, config.tse.concurrency, (uf) => fetchResult(uf));
  const ufs: ParsedResult[] = [];
  ufRes.forEach((r, i) => {
    if (r instanceof Error) console.warn(`[poller] UF ${ufCodes[i]}: ${r.message}`);
    else if (r) ufs.push(r);
  });
  // UF que falhou neste ciclo: mantém o último parse bom (o placar não "some" com um erro pontual)
  const got = new Set(ufs.map((u) => `uf:${u.code}`));
  const missing = Object.keys(state.ufs).filter((k) => !got.has(k));

  const batch = munTargets.length ? rotate(munTargets, config.munBatch) : [];
  const munRes = await pool(batch, config.tse.concurrency, (m) => fetchResult(m.uf.toLowerCase(), m.tse));
  const mun = batch.flatMap((m, i) => {
    const r = munRes[i];
    return r && !(r instanceof Error) ? [{ ibge: m.ibge, p: r }] : [];
  });

  const result = runCycle(state, { cands, br, ufs, mun, hist, y2022Map: y2022Map!, bigMunEl: config.bigMunEl });
  for (const k of missing) result.state.ufs[k] = state.ufs[k];
  state = result.state;

  const released = isReleased(new Date(), config.releaseAt);
  const flags = await out.flags();
  const board = toBoard(state, {
    cands, y2022Map: y2022Map!, flags, hist, released, releaseAt: config.releaseAt,
    sourceUrl: 'https://resultados.tse.jus.br',
  });
  const { generatedAt: _g, ...content } = board;
  const h = hashOf(content);
  if (h !== lastBoardHash) {
    await out.writeBoard(board);
    lastBoardHash = h;
    health.lastChange = Date.now();
  }
  if (released) {
    if (flags.map_mun) await out.writeMun(state, (ibge) => hist.byIbge.get(ibge)?.uf);
    await out.publish(result.changed, result.moments);
  }
  await out.persist(result.changed, result.moments, new Map());
  await writeJsonAtomic(stateFile, state);
  for (const m of result.moments) console.log(`[momento] ${m.title}`);
  const b = state.br;
  console.log(
    `[poller] ${released ? 'AO VIVO' : 'observação'} pst=${b?.pst ?? 0}% A=${b?.pa ?? 0}% B=${b?.pb ?? 0}% need=${b?.need ?? '-'} status=${b?.status} ufs=${ufs.length} mun=${mun.length} mudou=${result.changed.length}`,
  );
}

function rotate<T>(list: T[], n: number): T[] {
  const outList: T[] = [];
  for (let i = 0; i < Math.min(n, list.length); i++) outList.push(list[(munCursor + i) % list.length]);
  munCursor = (munCursor + n) % list.length;
  return outList;
}

let stopping = false;
async function loop() {
  await out.init();
  while (!stopping) {
    const started = Date.now();
    try {
      await cycle();
      health.lastOk = Date.now();
      health.consecutiveErrors = 0;
    } catch (e) {
      health.errors++;
      health.consecutiveErrors++;
      health.lastError = (e as Error).message;
      console.error(`[poller] erro (${health.consecutiveErrors}x): ${health.lastError}`);
    }
    const base = health.consecutiveErrors
      ? Math.min(120_000, config.intervalMs * 2 ** health.consecutiveErrors)
      : config.intervalMs;
    const wait = Math.max(1000, base - (Date.now() - started) + (Math.random() * 2 - 1) * config.jitterMs);
    await new Promise((r) => setTimeout(r, wait));
  }
}

// /health para o alerta "snapshot parado >60s" (cron com curl)
createServer((req, res) => {
  const age = health.lastOk ? Math.round((Date.now() - health.lastOk) / 1000) : null;
  const ok = age !== null && age < 60;
  res.writeHead(req.url === '/health' && !ok ? 503 : 200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok, ageSeconds: age, source: source.name, pst: state.br?.pst ?? null, ...health }));
}).listen(config.healthPort, () => console.log(`[poller] health em :${config.healthPort}/health`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    stopping = true;
    await out.close();
    process.exit(0);
  });
}

loop();
