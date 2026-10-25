# @apuracao/ws

Servidor WebSocket (uWebSockets.js): salas (`br`, UFs, `sala:<slug>`), chat moderado com slow mode automático,
reações agregadas (≤1 broadcast/s por sala) e fan-out de snapshots/momentos do placar. Protocolo em
`packages/shared/src/protocol.ts`.

```bash
pnpm --filter @apuracao/ws dev        # modo arquivo/memória (sem Redis)
pnpm --filter @apuracao/ws start
DATA_DIR=... tsx scripts/smoke.ts     # teste funcional (servidor com RELEASE_AT no passado, FILE_POLL_MS=300, SLOW_TRIGGER=2)
WS_URL=ws://host:3002/ws CONNS=20000 RAMP=500 DURATION=120 pnpm --filter @apuracao/ws load
```

Rotas: `/ws`, `/health` (JSON), `/metrics` (texto: conexões, msgs/s in/out, idade do último snapshot).

## Fontes de dados

- **Redis** (`REDIS_URL`): assina `ch:snap`, `ch:moment`, `ch:chat`, `ch:del`, `ch:flags`; histórico em `chat:<sala>`,
  reações em `react:<sala>`, flags em `flag:*` e `flag:rooms_closed`, online em `online:<worker>` (EX 15).
- **Arquivo** (sempre ligado): lê `DATA_DIR/br.json` a cada 2s e publica só os escopos que mudaram + momentos novos.
  É o modo de dev e o fallback se o Redis cair. Sem Redis, chat/reações ficam em memória (um processo só).
- Nada de `snap` antes de `RELEASE_AT` ou enquanto o `br.json` disser `released: false`.

## Variáveis

| Var | Padrão | |
|---|---|---|
| `PORT` / `HOST` | `3002` / `0.0.0.0` | |
| `SECRET` | `dev-secret` | mesmo da API (valida o cookie `aid`) |
| `REDIS_URL` | — | vazio = memória |
| `DATA_DIR` | `<repo>/public/data` | |
| `RELEASE_AT` | `2026-10-25T19:00:00-03:00` | |
| `WORKER_ID` | `<hostname>-<pid>` | |
| `TRUST_PROXY` | `1` | usa `cf-connecting-ip`/`x-forwarded-for`. **Só deixe 1 atrás de Cloudflare/Caddy** |
| `ALLOWED_ORIGINS` | — | ex.: `https://apuracao.com.br`; vazio = qualquer origem |
| `IP_CONN_LIMIT` | `30` | conexões por IP. CGNAT de operadora junta muita gente num IP: suba para 200+ se aparecer 429 |
| `MAX_ROOMS` | `4` | salas por conexão |
| `USER_BURST` / `USER_REFILL` | `3` / `0.5` | token bucket de mensagens por sessão (msgs/s) |
| `IP_BURST` / `IP_REFILL` | `20` / `2` | idem por IP |
| `REACT_BURST` / `REACT_REFILL` | `10` / `5` | reações por sessão |
| `SLOW_TRIGGER` / `SLOW_SECONDS` | `5` / `5` | slow mode liga acima de N msgs/s (média de 5s), desliga após 30s abaixo de N/2 |
| `REPORTS_TO_DELETE` | `3` | denúncias distintas para apagar |
| `BLOCKED_TERMS` / `BLOCKED_FILE` | — | termos extras (vírgula) / arquivo, um por linha, `#` comenta |
| `FILE_POLL_MS` | `2000` | |

## Vários workers

Workers são stateless; com Redis, rode 1 por vCPU, cada um num `PORT` próprio (3002, 3003, ...) e balanceie no Caddy:

```
handle /ws {
  reverse_proxy ws:3002 ws:3003 ws:3004 ws:3005 { lb_policy least_conn }
}
```

## Tuning obrigatório (VPS Linux)

Sem isso o servidor para em 1–4k conexões.

```bash
# /etc/sysctl.d/99-ws.conf
fs.file-max = 2097152
fs.nr_open = 2097152
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.core.netdev_max_backlog = 65535
sysctl --system
```

- `ulimit -n 1000000` no processo: systemd `LimitNOFILE=1000000`; Docker `ulimits: { nofile: { soft: 1000000, hard: 1000000 } }`.
- Caddy também precisa de `LimitNOFILE` alto (cada WS são 2 sockets nele).
- Node: `--max-old-space-size` proporcional à RAM do container; meça o heap em `/metrics` (`ws_heap_mb`) durante o teste de carga.
