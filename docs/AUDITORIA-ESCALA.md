# Auditoria de escala — noite do 2º turno (25/10/2026)

Objetivo: o que impede o site de aguentar dezenas de milhares de pessoas ao mesmo tempo no placar, no chat e nos
palpites, e o que fazer antes de domingo. Baseada no código (`main` em 24/10), em medições locais e numa leitura
só-leitura da VPS da OVH (nginx, kernel, memória, containers) em 24/10 03:30.

## Resumo

A arquitetura está certa para o problema (placar estático na CDN, WS stateless com Redis, subsalas com teto por
segundo, índice de palpites em memória). O que derruba o site domingo não é o desenho, são **limites de
infraestrutura que não foram aplicados** e **um custo de CPU escondido na API**:

| # | Gargalo | Teto hoje | Onde |
|---|---|---|---|
| 1 | nginx do host: `worker_connections 768`, 1024 arquivos abertos por worker | **~500 a 1000 WebSockets no total** | VPS, `/etc/nginx/nginx.conf` |
| 2 | `infra/sysctl-apuracao.conf` não foi aplicado; portas efêmeras 32768–60999; `nf_conntrack_max 65536` | ~20 mil conexões (conntrack), ~28 mil (portas nginx→Caddy) | VPS, kernel |
| 3 | Card PNG do palpite: >1 s de CPU **síncrono** por card, gerado ao abrir a página do palpite | **~1 palpite por segundo** satura a API; disco enche (230 KB por card, sem limpeza) | `apps/api/src/og.ts`, `GuessView.tsx` |
| 4 | Cloudflare não está cacheando `/` (HTML) nem `/api/stats` (`cf-cache-status: DYNAMIC`) | cada abertura de página e cada poll de stats bate na VPS | painel do Cloudflare |
| 5 | Qualquer deploy recria o Caddy e os 2 workers WS | 100% das conexões caem e reconectam de uma vez; build usa as 2 vCPUs por ~50 s | `infra/deploy.sh`, `Dockerfile` |
| 6 | Reconexão do WS no cliente: primeira tentativa em 1–3 s para todos; poll do placar sem timeout | queda de 1 worker = 50 mil handshakes em 2 s; um fetch pendurado congela o placar | `apps/web/src/lib/live.ts`, `App.tsx` |

Depois dos ajustes 1 e 2, o limite passa a ser memória: a máquina tem 3,8 GB, com ~2,1 GB livres (o hub usa
~1,7 GB, só o MySQL 534 MB). Cada WebSocket custa em torno de 20–40 KB somando kernel, nginx, Caddy e o worker.
Estimativa: **30 a 50 mil conexões simultâneas** cabem; acima disso, ou tira o Caddy do caminho do `/ws` ou
move o WS para outra máquina. O único jeito de saber o número real é o teste de carga de fora (seção 6).

---

## 1. Infra da VPS (crítico)

### 1.1 nginx do host

Medido na VPS:

```
worker_processes auto;      # = 2
worker_connections 768;
Max open files  1024 (soft) / 524288 (hard)   # nos workers do nginx
```

Cada WebSocket ocupa 2 conexões no nginx (cliente + upstream). Com 2 workers × 768, o teto teórico é ~760
WebSockets para a máquina inteira, dividido com o tráfego HTTP do hub. E o soft limit de 1024 arquivos abertos
por worker estoura antes disso ("socket() failed (24: Too many open files)" no error.log).

Correção (no `nginx.conf` compartilhado com o hub; é só subir limites, não muda rota nenhuma; `nginx -t && nginx -s
reload` não derruba conexões):

```nginx
worker_rlimit_nofile 262144;
events {
    worker_connections 65536;
    multi_accept on;
}
```

Conferir depois: `grep "open files" /proc/$(pgrep -n nginx)/limits` tem de mostrar 262144.

### 1.2 Kernel: sysctl do repositório não aplicado

Medido: `somaxconn 4096`, `ip_local_port_range 32768 60999`, `tcp_tw_reuse 2` (padrões do Ubuntu). O passo 1 do
README ("Montar do zero") não foi feito nessa VPS.

- Portas efêmeras: o nginx abre uma conexão `127.0.0.1:<porta>` → `127.0.0.1:8090` por WebSocket. Com o
  intervalo padrão são ~28 mil portas, ou seja, **~28 mil WebSockets no máximo**, mesmo com o nginx corrigido.
- conntrack: o Docker carrega o NAT, então cada conexão gera ~3 entradas (cliente→nginx, nginx→Caddy, Caddy→ws).
  `nf_conntrack_max = 65536` dá **~20 mil WebSockets**, e depois o kernel descarta pacotes em silêncio
  ("nf_conntrack: table full, dropping packet").

Correção: aplicar o arquivo do repositório e acrescentar o conntrack:

```bash
sudo cp /opt/apuracao/infra/sysctl-apuracao.conf /etc/sysctl.d/99-apuracao.conf
printf 'net.netfilter.nf_conntrack_max = 1048576\nnet.netfilter.nf_conntrack_tcp_timeout_established = 7200\n' | sudo tee -a /etc/sysctl.d/99-apuracao.conf
sudo sysctl --system
```

(1 M entradas ≈ 300 MB de RAM reservada só quando usada; 7200 s de timeout é maior que o idle do WS.)

Conferir: `sysctl net.ipv4.ip_local_port_range net.netfilter.nf_conntrack_max` e, na noite,
`cat /proc/sys/net/netfilter/nf_conntrack_count`.

### 1.3 Tirar o Caddy do caminho do `/ws` (recomendado, opcional)

Hoje: Cloudflare → nginx (host) → Caddy (container) → ws1/ws2. São dois proxies por conexão longa, cada um com
seus buffers e goroutines/eventos. Publicando os workers em `127.0.0.1:3002` e `127.0.0.1:3003`
(`infra/compose.ovh.yml`) e fazendo o nginx balancear `/ws` direto neles (`upstream ws { least_conn; ... }`), some
uma camada inteira de memória e uma entrada de conntrack por conexão, e o Caddy pode reiniciar sem derrubar o
chat. O Caddy continua servindo o site e `/data`. Mudança pequena nos dois arquivos de infra.

### 1.4 Memória e limites dos containers

Nenhum serviço tem `mem_limit` nem `NODE_OPTIONS`. Se um worker WS vazar ou a API empilhar renders de card, a
máquina inteira (incluindo o hub) vai para o swap antes de qualquer container morrer. Sugestão para o
`infra/compose.ovh.yml`:

| Serviço | `mem_limit` | `NODE_OPTIONS` |
|---|---|---|
| ws1, ws2 | 700m | `--max-old-space-size=512` |
| api | 600m | `--max-old-space-size=448` |
| poller | 300m | `--max-old-space-size=224` |
| redis | 300m (já tem `maxmemory 256mb`) | — |
| postgres | 300m | — |
| caddy | 300m | — |

Soma ≈ 2,5 GB, perto do que sobra. Se o teste de carga mostrar mais de ~400 MB por worker WS a 20 mil
conexões, o WS precisa de outra máquina.

### 1.5 IP real e limites por IP podem ser burlados

O nginx aceita conexão direta em `51.222.220.40:443` (não só via Cloudflare), e a API e o WS confiam no cabeçalho
`cf-connecting-ip` sem checar a origem. Quem bater direto no IP com um `cf-connecting-ip` inventado passa por cima
de todos os limites por IP (conexões, palpites, login). Correção no nginx: `set_real_ip_from` com as faixas da
Cloudflare + `real_ip_header CF-Connecting-IP`, e sobrescrever o cabeçalho quando a origem não é Cloudflare
(`proxy_set_header CF-Connecting-IP $remote_addr` num `map` por faixa). Alternativa mais simples: só permitir
443 a partir das faixas da Cloudflare no ufw (afeta o hub também, confirmar que ele está atrás da Cloudflare).

---

## 2. API (crítico: cards PNG)

### 2.1 Card do palpite custa mais de 1 s de CPU, de forma síncrona

Medido localmente num Mac (a vCPU da OVH é mais lenta, conte 2–3 s):

| Card | Tempo | Tamanho |
|---|---|---|
| palpite, Stories (1080×1350) | 1080 ms | 231 KB |
| palpite, OG (1200×630) | 1039 ms | 83 KB |
| placar, OG | 1335 ms | 83 KB |

`satori` é JS pesado e `Resvg.render()` é **síncrono**: enquanto renderiza, a API não responde nada (`/api/guess`,
`/`, `/api/me`, Super Chat). E a página do palpite ([GuessView.tsx:329](../apps/web/src/features/guess/GuessView.tsx:329))
tem `<img src={story}>`: **todo palpite novo dispara um render ao abrir a página**, mais um segundo render
(formato OG) quando o link é colado no WhatsApp. Com 1 palpite por segundo a API já está no limite; com 5 por
segundo ela para. O número esperado de palpites na tarde de domingo é bem maior que isso.

Agravante: `cached()` grava cada PNG em `var/og` sem limpeza. 230 KB + 83 KB por palpite → 100 mil palpites =
**~30 GB**; o disco tem 26 GB livres. E não há de-duplicação de renders em voo: N pedidos do mesmo card ao mesmo
tempo renderizam N vezes.

Correções, da mais barata para a mais completa (fazer pelo menos a, b e c):

- **a.** Tirar o `<img>` do card da página do palpite (ou desenhar a prévia no cliente com o `Ticket` que já
  existe). O PNG só é gerado quando a pessoa toca em compartilhar/baixar ou quando o WhatsApp busca a prévia.
- **b.** Fila com concorrência 1 em `cached()` + mapa de promessas em voo por chave; acima de ~20 na fila,
  responder `503` com `Retry-After: 5`. A CDN segura o resto.
- **c.** Não persistir cards de palpite em disco (manter um LRU em memória de ~300 PNGs); persistir só placar,
  cidade e momento, que são poucos.
- **d.** Versionar a URL do card do palpite (`?v=<hash do updatedAt>`, como `/p/:id` já faz): hoje quem refaz o
  palpite vê o card antigo por até 1 h na CDN.
- **e.** Mover o render para fora do event loop: `worker_threads` com 1 thread, ou um container `og` separado com
  `cpus: 0.5`. Assim nem um pico de compartilhamentos trava palpites e login.
- **f.** Investigar por que 1 s: as duas fotos entram como JPEG base64 de 161×225 e o resvg decodifica a cada
  render; pré-converter para PNG de 216 px uma vez (ou usar `renderAsync`) deve cortar bem o tempo.

### 2.2 Limites por IP vão barrar gente legítima (CGNAT)

Operadoras de celular colocam milhares de pessoas atrás do mesmo IP. Os baldes da API hoje:

| Rota | Rajada | Reposição | Efeito atrás de um IP de operadora |
|---|---|---|---|
| `POST /api/guess` | 5 | 1 a cada 12 s | a 6ª pessoa do mesmo IP no mesmo minuto recebe 429 |
| `POST /api/auth/google` | 10 | 1 a cada 5 s | fila de login no chat |
| `POST /api/auth/signup` | 10 | 1 a cada 10 s | idem |

O WS já teve esse cuidado (`IP_CONN_LIMIT=300`, `IP_BURST 20`). Na API: o palpite já é 1 por `aid` (upsert),
então o balde por IP pode ser folgado (ex.: rajada 60, 2/s); login e cadastro idem (rajada 60, 1/s). A proteção
contra abuso de verdade fica na regra de rate limiting do Cloudflare, que olha mais sinais que o IP.

### 2.3 Logs de requisição

Fastify em `level: info` escreve 2 linhas por requisição. A 300 req/s são 600 linhas/s para o json-file do
Docker. Em produção: `disableRequestLogging: true` (mantém warn/error) ou `LOG_LEVEL=warn` no `.env`.

### 2.4 Postgres

- `PgStore.sync()` roda a cada 15 s `where updated_at > $1` e não há índice em `updated_at`: varredura completa
  da tabela a cada 15 s. Acrescentar em `infra/schema.sql`:
  `create index if not exists guesses_updated_idx on guesses (updated_at);`
- O mesmo sync usa `>` com o último `updated_at` visto: dois palpites no mesmo milissegundo podem ser pulados
  por outro worker (só importa com mais de uma API). Usar `>=` e ignorar ids já vistos.
- Três pools na API (10 + 4 + 2) para um banco com `max_connections=40`; um pool só de 8 basta.

### 2.5 Cache do Cloudflare não está valendo

Medido em 24/10:

```
/data/br.json   cf-cache-status: REVALIDATED   (ok)
/               cf-cache-status: DYNAMIC       (vai à VPS a cada abertura)
/api/stats      cf-cache-status: DYNAMIC       (vai à VPS a cada poll)
```

O README descreve as cache rules, mas elas não estão ativas (ou não casam). Criar/conferir:

1. `GET /api/stats`, `/api/guesses/hist`, `/api/guess/*`, `/api/city/*` → "Eligible for cache", "Use cache-control
   header from origin". Respostas pessoais já saem `private, no-store` e ficam de fora.
2. HTML: `/`, `/tv`, `/embed/placar`, `/p/*`, `/cidade/*`, `/m/*`, `/sala/*` → mesma regra. Nenhuma dessas
   rotas seta cookie nem varia por pessoa (só as metas OG), e a API já manda `s-maxage=30`.
3. Ligar **Tiered Cache** (Caching → Tiered Cache, grátis): os PoPs do interior pedem ao PoP maior em vez de
   todos pedirem à VPS a cada 5 s.

Conferir com `curl -sI https://urnadigital.online/ | grep cf-cache-status` → `HIT`.

---

## 3. WebSocket (bom; ajustes finos)

O servidor está bem feito: `SHARED_COMPRESSOR` (sem janela por conexão), `publish` com JSON pré-serializado,
chat em lote por subsala, teto global por subsala via Redis, modo lento, baldes por pessoa e por IP, jump hash
para subsalas estáveis, moderação com cache e disjuntor. O que vale ajustar:

- **Tempestade de reconexão** (deploy, queda do Caddy): cada `join` faz 2 `LRANGE` no Redis e 50 `JSON.parse`.
  O worker já espelha toda mensagem entregue em `store.mem`; usar o espelho quando ele tem ≥ 50 mensagens e deixar
  o Redis só para o worker recém-nascido. 20 mil joins num minuto passam a custar zero no Redis.
- `strikes.muted()` faz 2 `GET` no Redis em **toda** tentativa de mensagem; guardar o resultado na conexão por
  5 s (ou só consultar quando houve punição nas últimas 24 h, com um flag no `hello`).
- Frames periódicos a 50 mil conexões: `online` a cada 10 s (5 k frames/s) + `react` a cada 2 s por sala
  (~25 k frames/s) + chat até 3 frames/s. Nada disso precisa de código: se o `ws_msgs_out_per_s` passar de ~150 k
  por worker, subir `REACT_FLUSH_MS=4000` e `CHAT_BATCH_MS=400` no `.env` e recriar só os workers.
- `maxBackpressure 256 KB` + `closeOnBackpressureLimit false`: cliente lento acumula até 256 KB e depois perde
  frames (inclusive `snap`). Como o `snap` é periódico, se recupera no próximo; só vale saber que é assim.
- Caddy: `reverse_proxy` sem `trusted_proxies` descarta o `X-Forwarded-For` do nginx; funciona hoje só porque o
  `cf-connecting-ip` passa intacto. Acrescentar `trusted_proxies private_ranges` nos dois `reverse_proxy`.

---

## 4. Poller (bom; medir o ciclo)

- Por ciclo: 27 UFs + 27 andamentos + até 150 cidades = ~200 requisições ao TSE com concorrência 4 e timeout
  8 s. Se o TSE responder em 300 ms, o ciclo leva ~15 s, mais que o intervalo de 12 s. Expor `cycleMs` no
  `/health` e, se passar de 10 s, `TSE_CONCURRENCY=8`.
- `persist()` faz até ~180 `INSERT` sequenciais por ciclo; um `INSERT ... VALUES (...), (...)` por lote resolve.
  Baixa prioridade: o Postgres aguenta.
- `var/poller-state-*.json` (1,4 MB) é reescrito a cada ciclo. Ok.
- Está bem: ETag, backoff exponencial, escrita atômica, hash para não reescrever, modo manual, singleton.

---

## 5. Deploy e operação na noite

### 5.1 Todo deploy derruba 100% do chat

`deploy.sh` faz `docker compose build` + `up -d`: a imagem do Caddy é reconstruída (leva o `dist` do web), então
o Caddy é recriado e **todas** as conexões WS caem e voltam ao mesmo tempo; o build ainda consome as duas vCPUs
por ~50 s com o site no ar. Para domingo:

- Freeze às 14h (já está no README). Depois disso, só deploy cirúrgico:
  `docker compose up -d --no-deps --build api` (ou `ws1`, depois `ws2`, com 60 s entre eles para o `least_conn`
  do Caddy redistribuir). Nunca o `caddy` depois das 17h.
- Acrescentar ao `deploy.sh` um modo `--only <serviço>` com reinício escalonado dos workers.
- Para depois: buildar a imagem no GitHub Actions e publicar no GHCR; a VPS só faz `pull` + `up`. Zero build na
  máquina de produção.

### 5.2 Visibilidade

Só o poller tem alerta. Antes de domingo:

- `alert.sh`: incluir `ws1`/`ws2` (`/health` com `redis: true`) e a API (`/api/health`).
- Cron de 1 min gravando em `var/metrics.log`: `ws_connections`, `ws_heap_mb`, `ws_msgs_out_per_s`,
  `ws_chat_busy_total` dos dois workers, `free -m`, `uptime`, `nf_conntrack_count`. Sem isso não dá para saber
  depois por que algo caiu.
- Cloudflare → Notifications → "Origin error rate" (5xx) para o celular.

### 5.3 Rodar os serviços compilados em vez de `tsx`

API, WS e poller rodam `tsx src/index.ts` em produção: cada processo transpila na partida e carrega o esbuild.
Funciona, mas um rollback às 19h fica mais lento e cada container gasta mais RAM. Compilar no `Dockerfile`
(`tsc` ou `esbuild --bundle`) e rodar `node dist/index.js`. Baixa prioridade, ganho pequeno mas certo.

---

## 5b. Frontend (`apps/web`)

Build ok (`vite build`, 2,4 s). Primeira visita ≈ 206 KB comprimidos (entry 139 KB + CSS 19 KB + fonte 48 KB);
mapa, palpite, painel, admin e gráficos já são chunks separados. O que o cliente pede à rede, por pessoa:

| Chamada | Intervalo | Cache |
|---|---|---|
| `/data/br.json` (`no-cache` → 304) | 30 s com WS, 10 s sem, ×3 com aba oculta; **de novo a cada mudança de `link`** | CDN |
| `/api/stats` | 30 s (não desacelera oculta) | CDN **se a regra existir** (hoje `DYNAMIC`) |
| `/data/site.json` | 60 s | CDN |
| `/data/mungrid.json` (**`no-store`**) | 15 s, **reiniciado a cada snapshot**; roda na **home** após as 17h | CDN, mas sem 304 |
| `/api/guess/:id` | 15 s em `/p/:id` | por id: cada visitante ≈ 1 hit na origem a cada 15 s |
| `/api/guesses/hist` | 60 s | CDN |
| `wss://…/ws` + `ping` da aplicação | ping a cada 25 s | — |
| `/data/static/dots.json` (180 KB gz), `municipalities.json` (135 KB gz) | uma vez | CDN 1 h |

A 50 mil pessoas: br.json ≈ 1,7 k req/s, stats ≈ 1,7 k, site ≈ 0,8 k, mungrid ≈ 3,3 k, tudo na borda da Cloudflare.
A origem vê ~1 requisição por TTL por PoP. Essa parte do desenho segura.

### Crítico

- **F1. Tempestade de reconexão** ([live.ts:89](../apps/web/src/lib/live.ts:89)): `base = min(30 s, 1 s·2^tentativa)`
  → na primeira queda, 2 s × (0,5–1,5) = **1 a 3 s para todo mundo**. Um worker reiniciado às 20h com 50 mil
  pessoas vira ~25 mil handshakes por segundo, cada um com `hello` + `snap` + 50 mensagens de histórico. Trocar
  por jitter cheio com janela larga: `delay = 1000 + random() × min(30 000, 4000 × 2^tentativa)` (1–9 s na
  primeira, 1–17 s na segunda). E `kick()` zera `attempt` e não reconecta enquanto `CONNECTING`: um handshake
  pendurado deixa o cliente preso; acrescentar timer de 10 s que fecha e reagenda.
- **F2. Poll do placar sem timeout** ([App.tsx:37](../apps/web/src/App.tsx:37), [api.ts:74](../apps/web/src/lib/api.ts:74)):
  `tick()` só reagenda depois do `await`; `getJSON` não tem `AbortSignal`. Se a CDN errar e a origem pendurar
  (o modo de falha da noite), o placar para de atualizar para sempre, e o WS pode estar caído junto. Colocar
  `signal: AbortSignal.timeout(8000)` no `getJSON` e tratar timeout como erro (mantém o último placar, segue).
  `stats`, `site` e `mungrid` usam `setInterval` sem guarda de requisição em voo: respostas lentas se empilham.
- **F3. `mungrid.json` com `no-store` e intervalo reiniciado a cada snapshot** ([citydata.ts:118](../apps/web/src/features/map/citydata.ts:118)):
  o efeito depende de `board.source.at`, que muda a cada poll, então além do timer de 15 s há um fetch imediato a
  cada mudança do br.json. `no-store` impede o 304: baixa os 10 KB inteiros toda vez. Roda na home de todo
  mundo depois das 17h. Depender só de `[enabled, layer, released]`, usar `no-cache`, pausar com aba oculta.
- **F4. Todo snapshot re-renderiza o chat inteiro e recalcula a grade de hexágonos** ([ChatView.tsx:76](../apps/web/src/features/chat/ChatView.tsx:76),
  [HexMap.tsx:226](../apps/web/src/features/map/HexMap.tsx:226)): o `ChatView` assina `board` inteiro só para
  o `GuessStrip`; `useCandidates()` devolve tupla nova a cada chamada; `ChatLine` não é memoizado. Cada `snap`,
  cada poll, cada `online` e cada lote de chat (até 4/s) re-renderiza 200 linhas. No mapa, `useCityValues`
  depende do `board` inteiro: cada snapshot recria `Values`, reconstrói os 4 níveis (~200 k hexágonos) e dispara
  a animação de 900 ms sem o mungrid ter mudado. Num Android mediano são 10–30 ms de thread principal várias
  vezes por segundo durante 5 horas. `React.memo` nas linhas, `useCandidates` estável, memos por
  `candidates[0].n`/`grid.at`.
- **F5. `setBoard` publica objeto novo mesmo sem mudança** ([board.ts:38](../apps/web/src/store/board.ts:38)):
  junto com F4, cada poll re-renderiza a árvore inteira. Sair cedo quando `b.generatedAt === cur.generatedAt`.
- **F6. Sem sinal de dado velho fora do `/painel`**: se o poller morrer e a CDN seguir servindo `stale-if-error`
  por 1 h, a home mostra números congelados com a bolinha "ao vivo". Mostrar "placar das HH:MM" quando
  `seenAt` passa de 90 s.
- **F7. `/api/guess/:id` a cada 15 s com TTL de 10 s**: cada id é único, a CDN quase não ajuda. 20 mil pessoas
  com `/p/:id` aberto = ~1,3 k req/s na API. Poll de 45–60 s com jitter, mais lento oculto, refresh ao voltar.

### Bom ter

- `stats`, `site` e `mungrid` não desaceleram com aba oculta (só o br.json). Pausar ou ×3 em todos.
- `ping` da aplicação a cada 25 s: 50 mil clientes = 2 k mensagens/s só de keep-alive; o uWS já faz ping de
  protocolo (`sendPingsAutomatically`). 50 s basta (idle do Caddy é 5 min).
- `municipalities.json` (558 KB cru) no formulário do palpite, o caminho quente antes das 17h: 50–100 ms de
  parse no celular. Um índice enxuto (ibge, nome, uf, slug, eleitorado) fica em 1/3.
- `dots.json` (180 KB gz) para todo visitante da home após as 17h; adiar o `MapCard` com o `WhenVisible` que já
  existe.
- Entry: radix popover + floating-ui + remove-scroll (~15 KB gz) entram pelo `datatip.tsx`; dá para carregar sob
  demanda. `aria-live="polite"` num log de 3 msg/s afoga leitores de tela.

### Já está bem

Placar via JSON estático com `no-cache` (304 na CDN), backoff com jitter e teto, reconexão em `online` e
`visibilitychange`, um WS só para tudo, snaps e JSON mesclados por timestamp (CDN velha nunca regride a UI),
chat limitado a 200 mensagens com dedupe, grade de hexágonos num worker, code-splitting por rota com prefetch,
skeletons, dev compilado fora da produção.

---

## 6. Teste de carga antes de domingo (obrigatório)

Depois de 1.1 e 1.2, de **outra máquina** (de dentro da VPS não passa pelo nginx nem pela Cloudflare):

```bash
WS_URL=wss://urnadigital.online/ws CONNS=10000 RAMP=300 DURATION=180 CHAT_RATE=50 REACT_RATE=500 SECRET=<o do .env> ROOM=br pnpm --filter @apuracao/ws load
```

Olhar ao mesmo tempo na VPS: `ws_connections` e `ws_heap_mb` nos dois workers, `free -m`,
`cat /proc/sys/net/netfilter/nf_conntrack_count`, `sudo tail -f /var/log/nginx/error.log` (procurar "worker_connections",
"Too many open files", "upstream"). Se 10 mil passam limpos, subir para 25 mil. O número que sair é o número
real da máquina; o resto deste documento são estimativas.

---

## 7. Checklist de domingo

- [ ] nginx: `worker_rlimit_nofile` + `worker_connections` (1.1) e reload
- [ ] sysctl aplicado + conntrack (1.2)
- [ ] `mem_limit` e `NODE_OPTIONS` nos containers (1.4)
- [ ] Card do palpite: tirar o `<img>` automático, fila de render, sem gravar em disco (2.1 a–c)
- [ ] Baldes por IP da API folgados (2.2)
- [ ] `LOG_LEVEL=warn` na API (2.3)
- [ ] Índice em `guesses(updated_at)` (2.4)
- [ ] Cache rules do Cloudflare ativas + Tiered Cache; `cf-cache-status: HIT` em `/` e `/api/stats` (2.5)
- [ ] Front: backoff largo + timeout no `getJSON` + mungrid sem `no-store` + `setBoard` sem objeto novo (F1–F5)
- [ ] Teste de carga de fora com 10 mil conexões (6)
- [ ] Alerta nos workers WS + cron de métricas (5.2)
- [ ] Freeze às 14h; deploy só com `--no-deps` depois disso (5.1)

## 8. O que já está bem (não mexer)

- Placar estático na CDN com `s-maxage=5`, `stale-while-revalidate` e `stale-if-error`, escrita atômica.
- WS: uWebSockets.js, compressor compartilhado, fan-out pré-serializado, subsalas invisíveis com teto, modo lento,
  baldes por pessoa e IP, workers stateless via Redis, limpeza de baldes ociosos.
- Moderação: filtro barato antes do modelo, lote de 200 ms, cache de veredito, disjuntor com backoff.
- Palpites: histogramas em memória (ranking O(1)), Postgres como verdade, sync incremental, fallback em arquivo.
- Poller: ETag, backoff, jitter, hash, estado em disco, modo manual, momentos idempotentes.
- Deploy com lock, checagem de saúde e rollback automático; kill switches via Redis.
