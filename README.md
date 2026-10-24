# Apuração Viral — 2º turno 2026

Placar ao vivo com dados oficiais do TSE, palpite compartilhável, sua cidade, chat por estado e comparação com o 1º turno e 2022.
Mobile-first. Contrato entre as partes: [CONTRACT.md](CONTRACT.md).

```
apps/poller   coleta TSE (ou replay), calcula, grava public/data/*.json + Redis + Postgres
apps/api      Fastify: palpites, ranking, cidade, cards PNG, HTML com meta OG
apps/ws       uWebSockets.js: salas, chat moderado, reações, fan-out de placar
apps/web      Vite + React (SPA estática)
packages/shared  tipos, parser TSE, cálculos, momentos, protocolo, moderação (com testes)
packages/data    ETL: municípios, 1º turno 2026, 2022, malhas IBGE, mapa de pontos, fontes, curva 2022
```

## Rodar local (sem Docker, sem Redis, sem Postgres)

```bash
pnpm install
pnpm etl
```

Em quatro terminais:

```bash
cd apps/poller && SOURCE=replay REPLAY_MINUTES=20 npx tsx src/index.ts
```

```bash
pnpm dev:api
```

```bash
pnpm dev:ws
```

```bash
pnpm dev:web
```

Abra http://localhost:5173.

**Barra de debug (só local):** com o poller em `SOURCE=replay`, aparece uma barra no topo para arrastar o
% apurado para frente e para trás, pausar/acelerar a noite, totalizar e forçar "antes das 17h". Ela fala
com `/__dev` (proxy do Vite para `:3003/dev`) e não entra no build de produção.

**Roteiro da noite:** `apps/poller/scenarios/domingo.json` (padrão) define a margem nacional de um
candidato conforme o % apurado — hoje: Bolsonaro começa empatado, abre ~3 pontos, perde fôlego e termina
50,5% × 49,5%. Crie outros arquivos e use `REPLAY_SCENARIO=<nome>`, ou `REPLAY_SCENARIO=aleatorio`.

O replay simula a noite inteira (17h → totalização) em 20 minutos no
mesmo formato JSON do TSE, a partir do 1º turno real de cada UF e município, com viradas.
Sem Redis o WS lê `public/data/br.json` a cada 2s; sem Postgres os palpites vão para `var/guesses.ndjson`.

**Mapa por cidade** (aba Mapa): ~27 mil pontos, 1 a cada ~6 mil eleitores, numa grade própria dentro do
contorno de cada uma das 5.570 cidades (`packages/data/scripts/dots.ts`, `DOTS_VPP` muda a densidade). O
poller lê o andamento de todas as cidades nos arquivos `-ab` de cada UF, busca votos só das que mudaram
(`MUN_PER_CYCLE`) e grava `public/data/mungrid.json` (~17 KB gzip): % apurado e % de A por cidade.

- **Grade** (padrão): o Brasil em hexágonos do mesmo tamanho (~55 km; 28 e 14 km com zoom). Cada um soma
  os pontos das cidades que caem nele (hexágono sem ponto herda do vizinho com dado, então a Amazônia não
  fica vazia), na cor de quem lidera, em três tons pela vantagem; o hexágono cresce de um ponto apagado até
  o tamanho cheio conforme a região é apurada. A grade é montada num worker (`hex.worker.ts`).
- **Pontos**: o ponto acende quando o % apurado da cidade passa do sorteio fixo dele e ganha a cor de um
  candidato na proporção dos votos da cidade.
- Zoom e arrasto nos dois: pinça e dois dedos no celular (um dedo arrasta só com zoom, para não prender a
  rolagem); no computador a rolagem dá zoom (afastado ao máximo, rolar para baixo volta a rolar a página);
  duplo toque, botões e teclado.

O mesmo mapa de hexágonos (`HexMap`) está no cartão da home e do painel (estático), na visão por estado da
aba Mapa (cada hexágono na cor do seu estado, com siglas e ficha ao passar o mouse), no painel da UF e na
página da cidade. O painel da UF abre como modal no desktop e gaveta de baixo no celular; nada abre pela lateral.

Testes: `pnpm test`.

## Produção (VPS)

### Onde está e como subir uma mudança

`urnadigital.online` roda na VPS da OVH `vps-57eba115` (51.222.220.40, 2 vCPU / 4 GB), em `/opt/apuracao`, dividindo a
máquina com o projeto "hub" (nginx, Next, PHP e MySQL fora do Docker). A apuração fica isolada num projeto do docker
compose que não publica porta nenhuma para fora: o nginx da máquina termina o HTTPS (certificado de origem da Cloudflare em
`/etc/ssl/urnadigital/`, válido até 2041) e repassa para o Caddy em `127.0.0.1:8090` (`infra/nginx-urnadigital.conf`,
`infra/compose.ovh.yml`). O `.env` da VPS liga o override (`COMPOSE_FILE`) e lista os 2 workers WS.

- **Push na `main` = deploy.** O GitHub Actions (`.github/workflows/deploy.yml`) roda typecheck e testes (~40 s) e chama
  `infra/deploy.sh` na VPS (~50 s): builda com o site no ar, troca os containers, confere API e WS e, se algo não ficar
  saudável, volta sozinho para a versão anterior. Um deploy por vez.
- **Na pressa (noite da apuração):** GitHub → Actions → Deploy → Run workflow, com "Pular typecheck e testes".
- **Voltar uma versão:** Run workflow com `rollback` (ou um commit), ou na VPS: `./infra/deploy.sh rollback`.
- **O chat não cai à toa:** os workers WS só reiniciam quando o código deles (`apps/ws`, `packages`, dependências,
  compose) muda, um de cada vez. Ajuste só na API ou no site não derruba conexão nenhuma. Cirúrgico, na VPS:
  `./infra/deploy.sh --only api` (ou `--only caddy`, `--only api,poller`). Depois das 17h, nunca `ws1`/`ws2` juntos.
- **O /ws não passa pelo Caddy:** o nginx da máquina manda direto para os workers (`127.0.0.1:3012` e `3013`,
  `least_conn`); o Caddy pode reiniciar sem derrubar o chat. O nginx também só aceita o `CF-Connecting-IP` vindo das
  faixas da Cloudflare (quem bate direto no IP com o cabeçalho inventado vira o próprio IP).
- **Limites da máquina** (aplicados em 24/10): nginx com `worker_rlimit_nofile 262144` e `worker_connections 65536`
  (`/etc/nginx/nginx.conf`, backup `.bak-*` ao lado); `infra/sysctl-apuracao.conf` em `/etc/sysctl.d/99-apuracao.conf`
  (portas de saída, conntrack de 1 M). Docker com `"userland-proxy": false` (`/etc/docker/daemon.json`): as portas
  em 127.0.0.1 passam por iptables, não por um processo `docker-proxy` com 2 sockets a mais por WebSocket. Cada
  container tem teto de memória (`infra/compose.ovh.yml`).
- **Teste de carga (24/10, do Mac direto na origem, 8 mil WebSockets):** zero falhas, load ~1, ~68 KB por conexão
  somando nginx (TLS) e kernel; os workers quase não sobem (~70 MB cada). Teto estimado: ~25 mil conexões na
  máquina. Pela Cloudflare, um IP só não passa de ~2.300 WebSockets simultâneos (503 da própria Cloudflare); para
  medir a origem: `WS_URL=wss://51.222.220.40/ws HOST=urnadigital.online` no `pnpm --filter @apuracao/ws load`, com
  `IP_CONN_LIMIT`/`IP_BURST`/`IP_REFILL` altos no `.env` só durante o teste.
- **Na noite:** `tail -f var/metrics.log` (uma linha por minuto: conexões e heap de cada worker, memória livre, load,
  conntrack) e `sudo tail -f /var/log/nginx/error.log`. O alerta no Telegram cobre poller, API e os dois workers.
- **Entrar na VPS:** `ssh -i ~/.ssh/urnadigital_ovh ubuntu@51.222.220.40` → `cd /opt/apuracao`, `docker compose ps`,
  `docker compose logs -f api ws1 poller`, `tail var/deploy.log`.
- Segredos do Actions: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`. A VPS lê o repositório com uma deploy key só de leitura.

### Montar do zero numa VPS própria

1. Kernel: `sudo cp infra/sysctl-apuracao.conf /etc/sysctl.d/99-apuracao.conf && sudo sysctl --system`
2. `cp .env.example .env` e preencha (`SECRET`, `ADMIN_TOKEN`, `POSTGRES_PASSWORD`, `SITE_HOST`, `PUBLIC_URL`).
3. `pnpm install && pnpm etl` (gera `public/data/static`, `apps/web/public/geo`, fontes dos cards).
4. `docker compose up -d --build`
5. Cron do alerta e das métricas: `* * * * * cd /opt/apuracao && ./infra/alert.sh >> var/alert.log 2>&1` e
   `* * * * * cd /opt/apuracao && ./infra/metrics.sh`

Cloudflare: proxy laranja em tudo; SSL "Full (strict)"; cache rule para `/data/*` com Edge TTL 5s
(respeitando `stale-while-revalidate`); cache total para `/assets/*`; rate limiting na regra free em `POST /api/guess`.
Uma segunda cache rule, "Eligible for cache" + "Use cache-control header", para `GET /api/stats`,
`/api/guesses/hist`, `/api/guess/*`, `/api/city/*` e o HTML das rotas públicas (`/`, `/tv`, `/embed/placar`, `/painel`,
`/mapa*`, `/palpite`, `/chat`, `/cidade*`, `/p/*`, `/m/*`, `/sala/*`): sem ela o Cloudflare não guarda caminho sem
extensão e cada visitante bate na VPS. Tiered Cache ligado (os PoPs pequenos pedem ao grande, não à VPS). As respostas pessoais já saem `private, no-store` e continuam fora do cache.
`stale-if-error` nos arquivos de `/data`: se a VPS cair, a CDN segue servindo o último placar por até 1 h.

### Salas grandes (subsalas invisíveis)

Acima de `SHARD_SIZE` pessoas (padrão 1500, somando todos os workers), a sala se divide em subsalas. Ninguém vê
a divisão: o nome, a torcida/reações, o histórico ao entrar e os momentos são da sala inteira; só o fluxo de
mensagens é por subsala. Cada subsala entrega no máximo `CHAT_CAP` mensagens por segundo (padrão 3); o que
passar volta para o autor como "sala muito movimentada" e o texto volta para o campo. Assim a banda por pessoa
fica em ~3 msg/s, seja a sala de 200 ou de 40 mil. O chat sai em lotes de `CHAT_BATCH_MS` (250 ms) com
permessage-deflate (`WS_COMPRESS=0` desliga), e a torcida é enviada a cada `REACT_FLUSH_MS` (2 s).
Métricas: `ws_shards_max`, `ws_chat_busy_total`. Teste: `SECRET=<o do .env> ROOM=br CONNS=3000 CHAT_RATE=80 pnpm load`.

### Moderação do chat

Mensagem passa por: silêncio em vigor → filtro local (tamanho, links, termos) → limite de taxa e modo
lento → repetição → modelo de decisão (OpenRouter, `OPENROUTER_API_KEY`), em lotes de ~200 ms numa só
chamada. Se o modelo falhar ou estourar a cota, um disjuntor deixa o chat só com o filtro local.

- Permitido: opinião, torcida e críticas/acusações duras a candidatos ("lula ladrão").
- Barrado: palavrão (inclusive contra candidato), ofensa a outra pessoa do chat, discriminação,
  ameaça, conteúdo sexual, spam.
- Punições graduais por pessoa e por IP (o IP precisa do dobro, por causa do CGNAT): palavrão vale 1,
  ofensa 2, discriminação/ameaça 3; 2 pontos = 2 min, 4 = 15 min, 6 = 2 h, 9 = 24 h. Spam tem escada
  própria (30 s → 1 h). Os pontos caem com o tempo.
- A primeira mensagem barrada de alguém aparece para todos como "mensagem censurada" (sem o texto);
  as seguintes não chegam ao chat de ninguém.
- Métricas em `/metrics` do WS (`ws_mod_ai_*`, `ws_chat_punished_total`, `ws_chat_muted_total`).

### Super Chat, patrocínio e painel admin

- **Super Chat** (ícone de cifrão na caixa do chat): valor + mensagem → Pix. A mensagem passa pelo filtro local e pelo
  modelo de moderação **antes** do Pix ser gerado; pago, vira um cartão colorido para a sala inteira (todas as subsalas, sem
  teto nem modo lento) e, a partir de R$ 10, fica fixado no topo por 2 min a 2 h conforme a faixa (`packages/shared/src/superchat.ts`).
  Recebimento: `WOOVI_APP_ID` (Woovi; webhook "Cobrança paga" em `/api/pix/webhook`, confirma sozinho; `WOOVI_API` aponta para o
  sandbox nos testes) ou só `PIX_KEY` (QR estático
  com valor; aprove em `/admin` ao ver no extrato). Em dev, sem nada configurado, a tela do Pix tem "Simular pagamento".
- **Faixa do topo:** patrocinador (nome, texto, link, logo) ou "anuncie aqui" com link para o WhatsApp (`AD_WHATSAPP`).
  Editada em `/admin`, publicada em `/data/site.json` (a CDN serve como o placar).
- **`/admin`**: carga da máquina e de cada worker WS, online, contas e palpites, Super Chats (aprovar/ocultar) e patrocínio.
  Token = `ADMIN_TOKEN` (em dev sem ele: `admin`). A API limita tentativas erradas.
- **Palpite:** cartão com contagem ao vivo, "fulano palpitou agora" e para que lado o Brasil está palpitando na tela Ao vivo;
  faixa "E o seu?" no topo do chat. Fecham às 17h.
- **LGPD:** aviso curto de cookies (só cookies necessários) com link para a política; some no "Entendi".

### Kill switches

```bash
./infra/flag.sh chat false
```

Também: `projection false`, `map_mun false`, `closeRoom sp` / `openRoom sp`. O front lê as flags a cada snapshot.

### Modo manual (se o TSE mudar o formato)

Cole o JSON em `var/manual/<mesmo caminho do TSE>`, por exemplo
`var/manual/ele2026/6258/dados/br/br-c0001-e006258-u.json`. Enquanto o arquivo existir, ele vence a rede.

## Domingo

| Hora | Ação |
|---|---|
| 14h | freeze de código |
| 16h | poller ligado (modo observação: grava internamente, `released=false`, nada público) |
| 17h | liberação automática por `RELEASE_AT`: placar, WS e projeção (projeção só ≥ 20% apurado) |
| — | olhar `curl localhost:3003/health`, `/metrics` dos workers e o chat |
| totalização | cards de resultado dos palpites passam a mostrar acerto e posição |

## Garantias legais embutidas

- Placar e projeção só a partir das 17h de Brasília, aplicado no servidor (poller e WS), não só no front.
- "Matematicamente definido" só quando a vantagem supera **todo** o eleitorado ainda não apurado.
- Projeção sempre com intervalo, rótulo "estimativa" e % apurado ao lado.
- Nunca "eleito" antes de `tf = s` (totalização final) do TSE.
