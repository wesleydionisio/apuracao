// Teste de carga: N conexões, joins em salas aleatórias, chat e reações a uma taxa configurável.
// Uso: WS_URL=ws://localhost:3002/ws CONNS=2000 RAMP=200 DURATION=60 CHAT_RATE=20 REACT_RATE=200 pnpm load
// Cada conexão manda um x-forwarded-for aleatório (o servidor precisa de TRUST_PROXY=1, padrão) para
// simular IPs distintos; contra produção rode de várias máquinas.
import WebSocket from 'ws';

const env = process.env;
const URL_ = env.WS_URL || 'ws://localhost:3002/ws';
const CONNS = Number(env.CONNS || 2000);
const RAMP = Number(env.RAMP || 200); // conexões por segundo
const DURATION = Number(env.DURATION || 60); // segundos após o ramp
const CHAT_RATE = Number(env.CHAT_RATE || 20); // msgs/s no total
const REACT_RATE = Number(env.REACT_RATE || 200); // reações/s no total
const UFS = ['sp', 'mg', 'rj', 'ba', 'rs', 'pr', 'pe', 'ce', 'pa', 'sc', 'go'];
const EMO = ['👀', '🔥', '😱'];

const socks: { ws: WebSocket; room: string }[] = [];
const pending = new Map<string, number>();
const lat: number[] = [];
const stats = { opened: 0, failed: 0, closed: 0, recv: 0, chatSent: 0, chatEcho: 0, errs: {} as Record<string, number> };
const rnd = (n: number) => Math.floor(Math.random() * n);
const fakeIp = () => `10.${rnd(250)}.${rnd(250)}.${rnd(250)}`;

function open() {
  const room = UFS[rnd(UFS.length)];
  const ws = new WebSocket(URL_, { headers: { 'x-forwarded-for': fakeIp() } });
  ws.on('open', () => {
    stats.opened++;
    ws.send(JSON.stringify({ t: 'join', rooms: ['br', room] }));
    socks.push({ ws, room });
  });
  ws.on('message', (raw) => {
    stats.recv++;
    const s = raw.toString();
    if (s.startsWith('{"t":"chat"')) {
      const msg = JSON.parse(s);
      const t0 = pending.get(msg.m.body);
      if (t0) {
        lat.push(Date.now() - t0);
        pending.delete(msg.m.body);
        stats.chatEcho++;
      }
    } else if (s.startsWith('{"t":"err"')) {
      const code = JSON.parse(s).code;
      stats.errs[code] = (stats.errs[code] ?? 0) + 1;
    }
  });
  ws.on('error', () => stats.failed++);
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
      if (s?.ws.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify({ t: 'react', r: 'br', e: EMO[rnd(3)] }));
    }
  }, 100);
  const report = setInterval(() => {
    console.log(
      `abertas=${socks.filter((s) => s.ws.readyState === WebSocket.OPEN).length} recv=${stats.recv} chat=${stats.chatSent}/${stats.chatEcho} ` +
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
      },
      null,
      1,
    ),
  );
  for (const s of socks) s.ws.close();
  setTimeout(() => process.exit(0), 500);
}

void main();
