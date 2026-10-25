# Contrato entre as partes

Tipos em `packages/shared/src/types.ts` e `protocol.ts`. Importar sempre de `@apuracao/shared`
(código só de servidor: `@apuracao/shared/server`).

## TSE (confirmado em 23/10/2026)

- Base: `https://resultados.tse.jus.br/oficial`
- 1º turno 2026 (presidente): eleição `6257`; 2º turno: `6258`. Ciclo `ele2026`.
- Resultado: `ele2026/<ele>/dados/<uf>/<uf>[<munTSE>]-c0001-e00<ele>-u.json` (`uf` minúsculo, `br`, `zz` = exterior).
  O caminho `dados-simplificados` de 2022 **não existe** em 2026.
- Andamento de todas as UFs: `ele2026/<ele>/dados/br/br-e00<ele>-ab.json`.
- Municípios + de-para IBGE (`cdi`) ↔ TSE (`cd`): `ele2026/<ele>/config/mun-e00<ele>-cm.json`.
- Os JSONs de 2022 saíram do site de resultados → 2022 vem do CSV de dados abertos.
- Amostras reais em `packages/data/fixtures/`.

## Arquivos estáticos (servidos em `/data/`, diretório `DATA_DIR`, padrão `public/data`)

Gerados pelo poller a cada ciclo (Cache-Control `s-maxage=5, stale-while-revalidate=30`):

| Caminho | Tipo | Notas |
|---|---|---|
| `/data/br.json` | `Board` | placar completo. Antes das 17h: `released=false`, `br=null`, `ufs={}`. `projection` (≥ 20% apurado): `pa/lo/hi` (faixa de 95%), `model` (`cidade` \| `uf`), `lead` (lado já confirmado, com histerese), `ufs` (faixa por UF com 20%+), `curve` (a faixa ao longo da noite) |
| `/data/mun/<UF>.json` | `MunBoard` | só municípios já coletados (top ~300 por eleitorado) |
| `/data/site.json` | `SiteConfig` | gravado pela API (boot e painel admin): patrocínio, "anuncie aqui", Super Chat ligado |

Gerados pelo ETL antes de domingo (cache longo):

| Caminho | Tipo |
|---|---|
| `/data/static/municipalities.json` | `Municipality[]` (todos os ~5570 + exterior) |
| `/data/static/hist/<id>.json` | `HistoryFile` com `br` + `uf` e `mun: {}` — `id` ∈ `t1-2026`, `y2022-t1`, `y2022-t2` |
| `/data/static/hist/<id>/<UF>.json` | `Record<ibge, HistRow>` |
| `/data/static/curve-2022.json` | `{ label, note, points: { pst: number, pct: Record<numCandidato, number> }[] }` — reconstrução, rotular como tal |

Geo (no build do web, `apps/web/public/geo/`):

| Caminho | Conteúdo |
|---|---|
| `/geo/uf.json` | GeoJSON FeatureCollection, `properties.uf` = sigla |
| `/geo/mun/<UF>.json` | GeoJSON FeatureCollection, `properties.ibge`, `properties.name` |

Coordenadas arredondadas (3 casas), malha IBGE "qualidade mínima".

## API (Fastify, `apps/api`, porta 3001)

| Rota | Resposta |
|---|---|
| `GET /api/me` | `{ id, nick, hue }` e seta cookie `aid` (assinado) |
| `GET /api/auth/me` | `{ user: { username, hue } \| null, google: clientId \| null, dev }` |
| `POST /api/auth/google` | body `{ credential }` (ID token do Google) → `{ user }` (conta existe, seta cookie `sid`) ou `{ signup: { token, name, email } }` |
| `POST /api/auth/signup` | body `{ token, name, phone, username }` → `{ user }` e cookie `sid`. Erros: `name`, `phone`, `username`, `taken`, `expired` |
| `GET /api/auth/username?u=` | `{ ok, valid }` (disponível / formato válido) |
| `POST /api/auth/logout` | apaga o cookie `sid` |
| `POST /api/auth/dev` | só sem `GOOGLE_CLIENT_ID` e fora de produção: body `{ email }`, mesmo retorno de `/google` |
| `POST /api/guess` | body `{ nick, pa, uf?, ufPa?, mun?, munPa? }` → `{ guess: Guess, url }`. 1 por `aid` (repostar atualiza). 403 `closed` depois das 17h |
| `GET /api/guess/:id` | `{ guess, live: { pa, dist, rank, total, ufRank?, ufTotal?, munRank?, munTotal? } \| null, final: boolean }` |
| `GET /api/city/:ibge` | `{ mun: Municipality, now: Snap \| null, t1: HistRow \| null, y2022: HistRow \| null, uf: Snap \| null, br: Snap \| null }` |
| `GET /api/city/by-slug/:uf/:slug` | idem |
| `GET /api/stats` | `{ online, guesses, topCities: { ibge, name, uf, n }[] }` (cache 10s) |
| `GET /api/og/guess/:id.png?f=story\|og` | PNG 1080×1350 (story) ou 1200×630 (og) |
| `GET /api/og/city/:ibge.png`, `/api/og/moment/:id.png`, `/api/og/board.png` | PNG 1200×630 |
| `GET /p/:id`, `/cidade/:uf/:slug`, `/m/:id`, `/sala/:slug`, `/` | `index.html` do web com `<meta og:*>` injetadas |
| `GET /api/stats` (extra) | também `guessesLastHour`, `guessAWins` (% dos palpites com A vencendo), `recentGuesses: { nick, pa, at }[]` |
| `POST /api/superchat` | sessão `sid`; body `{ room, body, amount (centavos), side }` → `ScCharge` (QR Pix). Moderado antes: 422 `blocked` + `cat`; 400 `long`/`amount`/`invalid`; 403 `muted`; 404 `off` |
| `GET /api/superchat/:id` | só o dono; `ScCharge` (`status`: `pending`/`paid`/`expired`/`hidden`). Consulta a Woovi no máximo a cada 5s |
| `POST /api/superchat/:id/dev-pay` | só com o provedor `dev` (fora de produção, sem Pix configurado) |
| `POST /api/pix/webhook` | Woovi (`OPENPIX:CHARGE_COMPLETED`, `charge.correlationID` = id do Super Chat); confirmado consultando a API |
| `POST /api/admin/flags` | header `x-admin-token`; body `{ chat?, projection?, map_mun?, closeRoom?, openRoom? }` |
| `GET /api/admin/overview` | carga da máquina, workers WS (`WS_URLS`), placar, usuários, totais de Super Chat, `projection` (`var/projection.json` do poller: modelo no ar, os dois modelos, diagnóstico) |
| `GET /api/admin/superchats`, `POST /api/admin/superchats/:id` | lista; body `{ action: 'approve' \| 'hide' }` |
| `GET/POST /api/admin/site` | patrocínio do topo e WhatsApp do "anuncie aqui"; publica `DATA_DIR/site.json` |
| `GET /api/health`, `GET /metrics` | |

## WebSocket (`apps/ws`, uWebSockets.js, porta 3002, caminho `/ws`)

Protocolo em `packages/shared/src/protocol.ts`. Regras:

- Cookie `aid` validado com `verifyAid` (segredo `SECRET`); sem cookie → id efêmero.
- Cookie `sid` (sessão da conta, `verifySession`): o apelido vira o nome de usuário (fixo) e `hello.you.auth = true`.
  **Só quem tem sessão manda mensagem**; sem ela, `chat` responde `err` com `code: 'auth'`. Reações/torcida seguem abertas.
- `join` → manda `snap` completo dos escopos das salas (`br` sempre; sala `sp` → `uf:SP`), `history` (últimas 50), `react` agregado.
- Depois só manda `snap` dos escopos que mudaram. Reações agregadas, no máximo 1×/s por sala.
- Antes de `released`: não manda `snap` nenhum.
- Super Chat: a API grava em `KEY.chat(r)` e `KEY.superchats(r)` e publica `CH.superchat`; o WS manda `chat` (com `m.sc` em centavos)
  para a sala inteira e, no `join`, `pins` com os recentes. Sem Redis a API faz `POST /internal` no WS (cabeçalho `x-internal: SECRET`).
- Fonte dos snapshots: Redis (`CH.snap`, `CH.moment`) se `REDIS_URL`; senão **modo arquivo**: lê `DATA_DIR/br.json` a cada 2s e faz o diff sozinho (também serve de fallback se o Redis cair).
- Sem `REDIS_URL`: chat/reações em memória (processo único) — usado em dev.

## Redis

Chaves e canais em `KEY` / `CH` (`protocol.ts`). Flags: `flag:chat`, `flag:projection`, `flag:map_mun` (`"0"` desliga), salas fechadas no SET `flag:rooms_closed`.
Online: cada worker WS grava `online:<worker>` = conexões, `EX 15`, a cada 5s.

## Variáveis de ambiente

| Var | Usado por | Padrão |
|---|---|---|
| `DATA_DIR` | poller, api, ws | `<repo>/public/data` |
| `REDIS_URL` | todos | vazio = memória/arquivo |
| `DATABASE_URL` | poller, api | vazio = sem Postgres (api usa `var/guesses.ndjson`) |
| `SECRET` | api, ws | `dev-secret` |
| `ADMIN_TOKEN` | api | vazio = admin desligado |
| `RELEASE_AT` | todos | `2026-10-25T17:00:00-03:00` |
| `TSE_ELECTION` / `TSE_T1` | poller | `6258` / `6257` |
| `CAND_A` / `CAND_B` | poller | ordem `seq` do TSE |
| `SOURCE` | poller | `tse` \| `replay` (simulação acelerada) |
| `PROJ_MIN_PST` | poller | `20` (% apurado para a projeção aparecer) |
| `GEO_DIR` | poller | `<repo>/apps/web/public/geo/mun` (vizinhança das cidades na projeção) |
| `PUBLIC_URL` | api | `http://localhost:5173` |
| `GOOGLE_CLIENT_ID` | api | vazio = sem login com Google (em dev, login de teste por e-mail) |
| `WOOVI_APP_ID` / `WOOVI_API` | api | Super Chat pela Woovi (confirma sozinho); `WOOVI_API` = sandbox nos testes |
| `PIX_KEY` / `PIX_NAME` / `PIX_CITY` | api | sem Woovi: QR estático, pagamento aprovado no `/admin` |
| `AD_WHATSAPP` | api | WhatsApp do "anuncie aqui" (o `/admin` também troca) |
| `WS_URLS` / `WS_INTERNAL_URL` | api | workers para o painel / entrega ao WS sem Redis (`http://127.0.0.1:3002`) |
