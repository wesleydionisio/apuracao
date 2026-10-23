// Teste funcional ponta a ponta contra um servidor em modo arquivo.
// O servidor precisa rodar com: DATA_DIR=<dir> RELEASE_AT=2020-01-01T00:00:00Z FILE_POLL_MS=300 SLOW_TRIGGER=2
// Uso: DATA_DIR=<dir> WS_URL=ws://localhost:3002/ws tsx scripts/smoke.ts
import assert from 'node:assert/strict';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { Board, Snap } from '@apuracao/shared';
import { signAid } from '@apuracao/shared/server';

const URL_ = process.env.WS_URL || 'ws://localhost:3002/ws';
const DIR = process.env.DATA_DIR!;
const SECRET = process.env.SECRET || 'dev-secret';
mkdirSync(DIR, { recursive: true });

const snap = (s: string, pst: number, a: number, b: number): Snap => ({
  s, at: '2026-10-25T18:00:00-03:00', pst, a, b, pa: (a / (a + b)) * 100, pb: (b / (a + b)) * 100, valid: a + b,
  blank: 0, nulls: 0, el: 1000, elc: 500, turnout: 400, status: 'apurando', lead: a > b ? 'a' : 'b', need: 55, rem: 300, rmax: 500,
});

function writeBoard(over: Partial<Board>) {
  const board: Board = {
    v: 1, generatedAt: new Date().toISOString(), released: true, releaseAt: '2020-01-01T00:00:00Z',
    source: { name: 'TSE', url: 'https://resultados.tse.jus.br', at: null },
    candidates: [], y2022Map: { a: '13', b: '22' }, flags: { chat: true, projection: true, map_mun: true },
    br: snap('br', 10, 510, 490), ufs: { 'uf:SP': snap('uf:SP', 12, 300, 200) }, remaining: [], projection: null,
    curve: [], moments: [], ...over,
  };
  const f = join(DIR, 'br.json');
  writeFileSync(f + '.tmp', JSON.stringify(board));
  renameSync(f + '.tmp', f);
}

class Client {
  ws: WebSocket;
  msgs: any[] = [];
  private waiters: { pred: (m: any) => boolean; res: (m: any) => void }[] = [];
  constructor(ip: string, cookie?: string) {
    const headers: Record<string, string> = { 'x-forwarded-for': ip };
    if (cookie) headers.cookie = `aid=${cookie}`;
    this.ws = new WebSocket(URL_, { headers });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      this.msgs.push(m);
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.res(m), false) : true));
    });
  }
  ready() {
    return new Promise<void>((res, rej) => {
      this.ws.once('open', () => res());
      this.ws.once('error', rej);
    });
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  /** espera uma mensagem (inclusive já recebida) que satisfaça pred */
  wait(pred: (m: any) => boolean, ms = 3000, label = 'mensagem'): Promise<any> {
    const got = this.msgs.find(pred);
    if (got) return Promise.resolve(got);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timeout esperando ${label}`)), ms);
      this.waiters.push({ pred, res: (m) => (clearTimeout(t), res(m)) });
    });
  }
  async none(pred: (m: any) => boolean, ms = 800) {
    await new Promise((r) => setTimeout(r, ms));
    assert.equal(this.msgs.find(pred), undefined);
  }
  clear() {
    this.msgs = [];
  }
  close() {
    this.ws.close();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: string[] = [];
const MID = `virada_uf:SP:b:${Date.now()}`;
async function step(name: string, fn: () => Promise<void>) {
  await fn();
  results.push(`ok - ${name}`);
  console.log(`ok - ${name}`);
}

async function main() {
  writeBoard({});
  await sleep(800);
  const cookie = signAid('11111111-2222-3333-4444-555555555555', SECRET);
  const c1 = new Client('1.1.1.1', cookie);
  const c2 = new Client('2.2.2.2');
  await Promise.all([c1.ready(), c2.ready()]);

  await step('hello + snap br no open', async () => {
    const h = await c1.wait((m) => m.t === 'hello');
    assert.ok(h.you.nick && h.you.id && typeof h.you.hue === 'number');
    assert.equal(h.flags.chat, true);
    const s = await c1.wait((m) => m.t === 'snap' && m.s === 'br');
    assert.equal(s.d.pst, 10);
  });

  await step('cookie aid assinado dá id estável', async () => {
    const c = new Client('9.9.9.9', cookie);
    await c.ready();
    const h1 = await c1.wait((m) => m.t === 'hello');
    const h2 = await c.wait((m) => m.t === 'hello');
    assert.equal(h1.you.id, h2.you.id);
    c.close();
  });

  await step('join: snap da UF + history', async () => {
    c1.send({ t: 'join', rooms: ['br', 'sp'] });
    c2.send({ t: 'join', rooms: ['sp', 'sala:minha-galera', 'xx', 'sala:A'] });
    const s = await c1.wait((m) => m.t === 'snap' && m.s === 'uf:SP');
    assert.equal(s.d.pst, 12);
    await c1.wait((m) => m.t === 'history' && m.r === 'sp');
    await c2.wait((m) => m.t === 'history' && m.r === 'sala:minha-galera');
    await c2.wait((m) => m.t === 'err' && m.code === 'invalid' && m.r === 'xx');
  });

  let msgId = '';
  await step('chat entregue para a sala', async () => {
    c1.send({ t: 'chat', r: 'sp', body: '  vai   virar hein  ' });
    const m = await c2.wait((x) => x.t === 'chat' && x.r === 'sp');
    assert.equal(m.m.body, 'vai virar hein');
    assert.ok(!('aid' in m.m));
    msgId = m.m.id;
  });

  await step('moderação: termo, leet, link, tamanho, sala não-membro', async () => {
    c1.clear();
    c1.send({ t: 'chat', r: 'sp', body: 'que p0rrrra' });
    await c1.wait((m) => m.t === 'err' && m.code === 'blocked', 2000, 'blocked termo');
    c1.clear();
    c1.send({ t: 'chat', r: 'sp', body: 'entra wa.me/551199' });
    await c1.wait((m) => m.t === 'err' && m.code === 'blocked', 2000, 'blocked link');
    c1.clear();
    c1.send({ t: 'chat', r: 'sp', body: 'x'.repeat(241) });
    await c1.wait((m) => m.t === 'err' && m.code === 'invalid', 2000, 'invalid tamanho');
    c1.clear();
    c1.send({ t: 'chat', r: 'rj', body: 'oi' });
    await c1.wait((m) => m.t === 'err' && m.code === 'invalid' && m.r === 'rj', 2000, 'não-membro');
  });

  await step('rate limit por sessão', async () => {
    await sleep(2500);
    c1.clear();
    for (let i = 0; i < 6; i++) c1.send({ t: 'chat', r: 'sp', body: `rajada ${i}` });
    await c1.wait((m) => m.t === 'err' && m.code === 'rate', 2000, 'rate');
  });

  await step('reações agregadas', async () => {
    c1.clear();
    for (let i = 0; i < 3; i++) c2.send({ t: 'react', r: 'sp', e: '🔥' });
    c2.send({ t: 'react', r: 'sp', e: '💩' });
    const r = await c1.wait((m) => m.t === 'react' && m.r === 'sp' && m.agg['🔥'] >= 3, 2500, 'react agg');
    assert.equal(r.agg['💩'], undefined);
  });

  await step('report: 3 denúncias distintas apagam', async () => {
    c2.clear();
    const rs = [new Client('3.3.3.1'), new Client('3.3.3.2'), new Client('3.3.3.3')];
    await Promise.all(rs.map((c) => c.ready()));
    for (const c of rs) c.send({ t: 'join', rooms: ['sp'] });
    await Promise.all(rs.map((c) => c.wait((m) => m.t === 'history')));
    // autor não conta
    c1.send({ t: 'report', r: 'sp', id: msgId });
    rs[0].send({ t: 'report', r: 'sp', id: msgId });
    rs[1].send({ t: 'report', r: 'sp', id: msgId });
    await c2.none((m) => m.t === 'del', 600);
    rs[2].send({ t: 'report', r: 'sp', id: msgId });
    const d = await c2.wait((m) => m.t === 'del' && m.id === msgId, 2000, 'del');
    assert.equal(d.r, 'sp');
    const late = new Client('3.3.3.9');
    await late.ready();
    late.send({ t: 'join', rooms: ['sp'] });
    const h = await late.wait((m) => m.t === 'history' && m.r === 'sp');
    assert.ok(!h.m.some((x: any) => x.id === msgId), 'mensagem apagada não volta no history');
    for (const c of [...rs, late]) c.close();
  });

  await step('nick: troca válida e bloqueada', async () => {
    c1.clear();
    c1.send({ t: 'nick', nick: 'Torcedor do Sertão' });
    const h = await c1.wait((m) => m.t === 'hello');
    assert.equal(h.you.nick, 'Torcedor do Sertão');
    c1.clear();
    c1.send({ t: 'nick', nick: 'puta que pariu' });
    await c1.wait((m) => m.t === 'err' && m.code === 'invalid');
  });

  await step('mudança no br.json: só escopos alterados + momento + mensagem de sistema', async () => {
    c1.clear();
    c2.clear();
    writeBoard({
      br: snap('br', 25, 600, 640),
      moments: [{ id: MID, kind: 'virada_uf', scope: 'uf:SP', title: '⚡ São Paulo virou', at: new Date().toISOString() }],
    });
    const s = await c1.wait((m) => m.t === 'snap' && m.s === 'br', 3000, 'snap br');
    assert.equal(s.d.pst, 25);
    await c1.none((m) => m.t === 'snap' && m.s === 'uf:SP', 400);
    await c1.wait((m) => m.t === 'moment' && m.m.id === MID);
    await c1.wait((m) => m.t === 'chat' && m.r === 'br' && m.m.sys && m.m.body.includes('São Paulo virou'));
    await c2.wait((m) => m.t === 'chat' && m.r === 'sp' && m.m.sys);
    // mesmo momento de novo não repete
    c1.clear();
    writeBoard({ br: snap('br', 26, 600, 640), moments: [{ id: MID, kind: 'virada_uf', scope: 'uf:SP', title: '⚡ São Paulo virou', at: new Date().toISOString() }] });
    await c1.wait((m) => m.t === 'snap' && m.s === 'br' && m.d.pst === 26);
    await c1.none((m) => m.t === 'moment', 500);
  });

  await step('slow mode automático e anúncio', async () => {
    const spam = await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const c = new Client(`4.4.4.${i}`);
        await c.ready();
        c.send({ t: 'join', rooms: ['rj'] });
        await c.wait((m) => m.t === 'history');
        return c;
      }),
    );
    let k = 0;
    const timer = setInterval(() => spam[k++ % spam.length].send({ t: 'chat', r: 'rj', body: `spam ${k}` }), 60);
    await spam[0].wait((m) => m.t === 'slow' && m.r === 'rj' && m.seconds > 0, 8000, 'slow on');
    clearInterval(timer);
    const c = spam[1];
    c.clear();
    c.send({ t: 'chat', r: 'rj', body: 'primeira' });
    c.send({ t: 'chat', r: 'rj', body: 'segunda' });
    const e = await c.wait((m) => m.t === 'err' && m.code === 'slow', 3000, 'err slow');
    assert.ok(e.wait > 0);
    const late = new Client('4.4.5.1');
    await late.ready();
    late.send({ t: 'join', rooms: ['rj'] });
    await late.wait((m) => m.t === 'slow' && m.seconds > 0, 2000, 'slow on join');
    for (const x of [...spam, late]) x.close();
  });

  await step('ping/pong', async () => {
    c1.send({ t: 'ping' });
    await c1.wait((m) => m.t === 'pong');
  });

  await step('flags.chat=false desliga o chat (modo arquivo)', async () => {
    c1.clear();
    writeBoard({ br: snap('br', 26, 600, 640), flags: { chat: false, projection: true, map_mun: true } });
    await c1.wait((m) => m.t === 'flags' && m.flags.chat === false, 3000, 'flags');
    await sleep(1500);
    c1.send({ t: 'chat', r: 'br', body: 'oi' });
    await c1.wait((m) => m.t === 'err' && m.code === 'off');
  });

  await step('antes do released: nenhum snap', async () => {
    writeBoard({ released: false });
    await sleep(800);
    const c = new Client('5.5.5.5');
    await c.ready();
    c.send({ t: 'join', rooms: ['sp'] });
    await c.wait((m) => m.t === 'history');
    await c.none((m) => m.t === 'snap', 500);
    c.close();
  });

  c1.close();
  c2.close();
  console.log(`\n${results.length} passos ok`);
  setTimeout(() => process.exit(0), 300);
}

main().catch((e) => {
  console.error('FALHOU:', e.message);
  process.exit(1);
});
