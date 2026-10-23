// Poller singleton: TSE (ou replay) → normaliza → JSON estático + Redis + Postgres.
// Ciclo de ~12s com jitter, backoff exponencial em erro, grava só quando o conteúdo muda.
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import {
  DEFAULT_RELEASE_AT,
  detectCandidates,
  parseColorMap,
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
import { ReplaySource, T_END } from './replay';
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
/** só no replay local: forçar "antes das 17h" / "ao vivo" para depurar as duas telas */
let releaseOverride: 'auto' | 'on' | 'off' = 'auto';
const replay = source instanceof ReplaySource ? source : null;
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

async function cycle(opts: { allMun?: boolean } = {}) {
  const br = await fetchResult('br');
  if (!br) throw new Error('arquivo BR do 2º turno indisponível');
  if (!cands) {
    cands = detectCandidates(br, {
      a: config.cand.a,
      b: config.cand.b,
      colors: config.colors,
      colorByNum: parseColorMap(config.colorByNum),
      photo: (n) => (existsSync(path.join(config.photoDir, `${n}.jpg`)) ? `/cand/${n}.jpg` : undefined),
    });
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

  const batch = !munTargets.length ? [] : opts.allMun ? munTargets : rotate(munTargets, config.munBatch);
  const munRes = await pool(batch, config.tse.concurrency, (m) => fetchResult(m.uf.toLowerCase(), m.tse));
  const mun = batch.flatMap((m, i) => {
    const r = munRes[i];
    return r && !(r instanceof Error) ? [{ ibge: m.ibge, p: r }] : [];
  });

  // momentos com a hora do TSE (e não a do servidor): na simulação as duas divergem
  const result = runCycle(state, { cands, br, ufs, mun, hist, y2022Map: y2022Map!, bigMunEl: config.bigMunEl, now: br.at });
  for (const k of missing) result.state.ufs[k] = state.ufs[k];
  state = result.state;

  const released = releaseOverride === 'auto' ? isReleased(new Date(), config.releaseAt) : releaseOverride === 'on';
  // "antes das 17h" forçado mostra a contagem para o horário real de domingo
  const releaseAt = releaseOverride === 'off' ? new Date(DEFAULT_RELEASE_AT) : config.releaseAt;
  const flags = await out.flags();
  const board = toBoard(state, {
    cands, y2022Map: y2022Map!, flags, hist, released, releaseAt,
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

/** ciclos e comandos de debug nunca rodam ao mesmo tempo */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

let wake: (() => void) | null = null;
const sleep = (ms: number) =>
  new Promise<void>((r) => {
    const t = setTimeout(r, ms);
    wake = () => {
      clearTimeout(t);
      r();
    };
  });

/**
 * Replay: volta/avança para o instante t refazendo a noite do zero em passos curtos,
 * para o gráfico e os momentos ficarem coerentes com o novo ponto.
 */
async function rebuildTo(t: number) {
  if (!replay || !cands) return;
  state = emptyState();
  munCursor = 0;
  const steps = Math.max(1, Math.min(120, Math.ceil(t * 120)));
  for (let i = 1; i < steps; i++) {
    replay.setT((t * i) / steps);
    const br = await fetchResult('br');
    if (!br) continue;
    const ufs = (await Promise.all(TSE_UFS.map((uf) => fetchResult(uf)))).filter((x): x is ParsedResult => !!x);
    state = runCycle(state, { cands, br, ufs, mun: [], hist, y2022Map: y2022Map!, bigMunEl: config.bigMunEl, now: br.at }).state;
  }
  replay.setT(t);
  await cycle({ allMun: true });
}

let stopping = false;
async function loop() {
  await out.init();
  while (!stopping) {
    const started = Date.now();
    try {
      await serial(() => cycle());
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
    await sleep(wait);
  }
}

async function readBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  let s = '';
  for await (const chunk of req) s += chunk;
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

function devStatus() {
  const r = replay!.status();
  return { ...r, tEnd: T_END, pst: state.br?.pst ?? 0, status: state.br?.status ?? null, released: releaseOverride, br: state.br };
}

/** /dev — controles da simulação para a barra de debug local (só existe com SOURCE=replay) */
async function handleDev(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  if (!replay) {
    res.writeHead(404).end(JSON.stringify({ error: 'só no modo replay' }));
    return;
  }
  if (req.method === 'POST') {
    const b = await readBody(req);
    await serial(async () => {
      if (typeof b.speed === 'number') replay.setSpeed(b.speed);
      if (typeof b.playing === 'boolean') replay.setPlaying(b.playing);
      if (b.released === 'auto' || b.released === 'on' || b.released === 'off') releaseOverride = b.released;
      let target: number | null = null;
      if (b.reset === true) target = 0;
      else if (b.total === true) target = T_END;
      else if (typeof b.t === 'number') target = b.t;
      else if (typeof b.pst === 'number') target = replay.tForPst(b.pst);
      if (target !== null) await rebuildTo(target);
      else await cycle();
    });
    wake?.();
  }
  res.writeHead(200).end(JSON.stringify(devStatus()));
}

// /health para o alerta "snapshot parado >60s" (cron com curl)
createServer((req, res) => {
  if (req.url?.startsWith('/dev')) {
    handleDev(req, res).catch((e) => res.writeHead(500).end(JSON.stringify({ error: (e as Error).message })));
    return;
  }
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
