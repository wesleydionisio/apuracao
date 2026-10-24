// Teste de carga: N conexões, joins em salas aleatórias, chat e reações a uma taxa configurável.
// Uso: WS_URL=ws://localhost:3002/ws CONNS=2000 RAMP=200 DURATION=60 CHAT_RATE=20 REACT_RATE=200 pnpm load
// Cada conexão manda um x-forwarded-for aleatório (o servidor precisa de TRUST_PROXY=1, padrão) para
// simular IPs distintos; contra produção rode de várias máquinas.
// SECRET=<o mesmo do servidor> assina uma sessão por conexão (só quem entrou manda mensagem).
// ROOM=br põe todo mundo na mesma sala (o pior caso: as subsalas invisíveis entram em ação).
import { signToken } from '@apuracao/shared/server';
import WebSocket from 'ws';

const env = process.env;
const URL_ = env.WS_URL || 'ws://localhost:3002/ws';
const CONNS = Number(env.CONNS || 2000);
const RAMP = Number(env.RAMP || 200); // conexões por segundo
const DURATION = Number(env.DURATION || 60); // segundos após o ramp
const CHAT_RATE = Number(env.CHAT_RATE || 20); // msgs/s no total
const REACT_RATE = Number(env.REACT_RATE || 200); // reações/s no total
const SECRET = env.SECRET || '';
const ONLY = env.ROOM || '';
const UFS = ['sp', 'mg', 'rj', 'ba', 'rs', 'pr', 'pe', 'ce', 'pa', 'sc', 'go'];
const EMO = ['👀', '🔥', '😱'];

const socks: { ws: WebSocket; room: string }[] = [];
const pending = new Map<string, number>();
const lat: number[] = [];
const stats = { opened: 0, failed: 0, closed: 0, recv: 0, frames: 0, chatSent: 0, chatEcho: 0, chatRecv: 0, errs: {} as Record<string, number> };
const rnd = (n: number) => Math.floor(Math.random() * n);
const fakeIp = () => `10.${rnd(250)}.${rnd(250)}.${rnd(250)}`;
let seq = 0;

function onMsg(msg: { t: string; m?: { body: string }; b?: unknown[]; code?: string }) {
  stats.recv++;
  if (msg.t === 'batch') {
    stats.recv--;
    for (const x of msg.b ?? []) onMsg(x as typeof msg);
  } else if (msg.t === 'chat' && msg.m) {
    stats.chatRecv++;
    const t0 = pending.get(msg.m.body);
    if (t0) {
      lat.push(Date.now() - t0);
      pending.delete(msg.m.body);
      stats.chatEcho++;
    }
  } else if (msg.t === 'err' && msg.code) {
    stats.errs[msg.code] = (stats.errs[msg.code] ?? 0) + 1;
  }
}

function open() {
  const room = ONLY || UFS[rnd(UFS.length)];
  const i = ++seq;
  const headers: Record<string, string> = { 'x-forwarded-for': fakeIp() };
  if (SECRET) headers.cookie = `sid=${signToken({ uid: `carga-${i}`, user: `carga${i}` }, SECRET)}`;
  // HOST=urnadigital.online com WS_URL=wss://<ip da VPS>/ws: testa a origem sem a Cloudflare (que limita conexões
  // simultâneas por IP de quem testa); o certificado de origem não vale para o IP, daí o rejectUnauthorized
  if (env.HOST) headers.host = env.HOST;
  // servername vai para o tls.connect (os tipos do ws não listam, mas ele repassa)
  const opts = (env.HOST ? { headers, servername: env.HOST, rejectUnauthorized: false } : { headers }) as WebSocket.ClientOptions;
  const ws = new WebSocket(URL_, opts);
  ws.on('open', () => {
    stats.opened++;
    ws.send(JSON.stringify({ t: 'join', rooms: ONLY ? [ONLY] : ['br', room] }));
    ws.send(JSON.stringify({ t: 'side', side: rnd(2) ? 'a' : 'b' }));
    socks.push({ ws, room });
  });
  ws.on('message', (raw) => {
    stats.frames++;
    onMsg(JSON.parse(raw.toString()));
  });
  ws.on('error', (e) => {
    stats.failed++;
    const k = `conn: ${e.message.slice(0, 60)}`;
    stats.errs[k] = (stats.errs[k] ?? 0) + 1;
  });
  ws.on('close', () => stats.closed++);
}

const pct = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function main() {
  console.log(`carga: ${CONNS} conexões em ${URL_}, ramp ${RAMP}/s, ${DURATION}s`);
  const t0 = Date.now();
  for (let i = 0; i < CONNS; i++) {
    open();
    if ((i + 1) % RAMP === 0) await new Promise((r) => setTimeout(r, 1000));
  }
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`ramp: ${stats.opened} abertas, ${stats.failed} falhas em ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  let n = 0;
  const chatTimer = setInterval(() => {
    for (let i = 0; i < CHAT_RATE / 10; i++) {
      const s = socks[rnd(socks.length)];
      if (!s || s.ws.readyState !== WebSocket.OPEN) continue;
      const body = `carga msg ${++n} ${rnd(1e6)}`;
      pending.set(body, Date.now());
      s.ws.send(JSON.stringify({ t: 'chat', r: s.room, body }));
      stats.chatSent++;
    }
  }, 100);
  const reactTimer = setInterval(() => {
    for (let i = 0; i < REACT_RATE / 10; i++) {
      const s = socks[rnd(socks.length)];
      if (s?.ws.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify({ t: 'react', r: ONLY || 'br', e: EMO[rnd(3)] }));
    }
  }, 100);
  let lastChat = 0;
  const report = setInterval(() => {
    const open = socks.filter((s) => s.ws.readyState === WebSocket.OPEN).length;
    const perConn = (stats.chatRecv - lastChat) / 5 / Math.max(1, open);
    lastChat = stats.chatRecv;
    console.log(
      `abertas=${open} recv=${stats.recv} frames=${stats.frames} chat=${stats.chatSent}/${stats.chatEcho} chat/s/conexão=${perConn.toFixed(2)} ` +
        `p50=${pct(lat, 50)}ms p99=${pct(lat, 99)}ms errs=${JSON.stringify(stats.errs)}`,
    );
  }, 5000);
  await new Promise((r) => setTimeout(r, DURATION * 1000));
  clearInterval(chatTimer);
  clearInterval(reactTimer);
  clearInterval(report);
  await new Promise((r) => setTimeout(r, 1500));
  console.log(
    JSON.stringify(
      {
        ...stats,
        latencyMs: { p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99), max: pct(lat, 100), samples: lat.length },
        lostEchoes: pending.size,
        // bytes no fio (depois do deflate), por conexão
        wireKBPerConn: +(socks.reduce((a, s) => a + ((s.ws as unknown as { _socket?: { bytesRead: number } })._socket?.bytesRead ?? 0), 0) / 1024 / Math.max(1, socks.length)).toFixed(1),
      },
      null,
      1,
    ),
  );
  for (const s of socks) s.ws.close();
  setTimeout(() => process.exit(0), 500);
}

void main();
