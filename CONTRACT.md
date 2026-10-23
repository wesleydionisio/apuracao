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
| `/data/br.json` | `Board` | placar completo. Antes das 17h: `released=false`, `br=null`, `ufs={}` |
| `/data/mun/<UF>.json` | `MunBoard` | só municípios já coletados (top ~300 por eleitorado) |

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
| `POST /api/guess` | body `{ nick, pa, uf?, ufPa?, mun?, munPa? }` → `{ guess: Guess, url }`. 1 por `aid` (repostar atualiza). 403 `closed` depois das 17h |
| `GET /api/guess/:id` | `{ guess, live: { pa, dist, rank, total, ufRank?, ufTotal?, munRank?, munTotal? } \| null, final: boolean }` |
| `GET /api/city/:ibge` | `{ mun: Municipality, now: Snap \| null, t1: HistRow \| null, y2022: HistRow \| null, uf: Snap \| null, br: Snap \| null }` |
| `GET /api/city/by-slug/:uf/:slug` | idem |
| `GET /api/stats` | `{ online, guesses, topCities: { ibge, name, uf, n }[] }` (cache 10s) |
| `GET /api/og/guess/:id.png?f=story\|og` | PNG 1080×1350 (story) ou 1200×630 (og) |
| `GET /api/og/city/:ibge.png`, `/api/og/moment/:id.png`, `/api/og/board.png` | PNG 1200×630 |
| `GET /p/:id`, `/cidade/:uf/:slug`, `/m/:id`, `/sala/:slug`, `/` | `index.html` do web com `<meta og:*>` injetadas |
| `POST /api/admin/flags` | header `x-admin-token`; body `{ chat?, projection?, map_mun?, closeRoom?, openRoom? }` |
| `GET /api/health`, `GET /metrics` | |

## WebSocket (`apps/ws`, uWebSockets.js, porta 3002, caminho `/ws`)

Protocolo em `packages/shared/src/protocol.ts`. Regras:

- Cookie `aid` validado com `verifyAid` (segredo `SECRET`); sem cookie → id efêmero.
- `join` → manda `snap` completo dos escopos das salas (`br` sempre; sala `sp` → `uf:SP`), `history` (últimas 50), `react` agregado.
- Depois só manda `snap` dos escopos que mudaram. Reações agregadas, no máximo 1×/s por sala.
- Antes de `released`: não manda `snap` nenhum.
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
| `PUBLIC_URL` | api | `http://localhost:5173` |
