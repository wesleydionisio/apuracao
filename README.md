# Apuração Viral — 2º turno 2026

Placar ao vivo com dados oficiais do TSE, palpite compartilhável, sua cidade, chat por estado e comparação com o 1º turno e 2022.
Mobile-first. Contrato entre as partes: [CONTRACT.md](CONTRACT.md).

```
apps/poller   coleta TSE (ou replay), calcula, grava public/data/*.json + Redis + Postgres
apps/api      Fastify: palpites, ranking, cidade, cards PNG, HTML com meta OG
apps/ws       uWebSockets.js: salas, chat moderado, reações, fan-out de placar
apps/web      Vite + React (SPA estática)
packages/shared  tipos, parser TSE, cálculos, momentos, protocolo, moderação (com testes)
packages/data    ETL: municípios, 1º turno 2026, 2022, malhas IBGE, fontes, curva 2022
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

Testes: `pnpm test`.

## Produção (VPS)

1. Kernel: `sudo cp infra/sysctl-apuracao.conf /etc/sysctl.d/99-apuracao.conf && sudo sysctl --system`
2. `cp .env.example .env` e preencha (`SECRET`, `ADMIN_TOKEN`, `POSTGRES_PASSWORD`, `SITE_HOST`, `PUBLIC_URL`).
3. `pnpm install && pnpm etl` (gera `public/data/static`, `apps/web/public/geo`, fontes dos cards).
4. `docker compose up -d --build`
5. Cron do alerta: `* * * * * cd /opt/apuracao && ./infra/alert.sh >> var/alert.log 2>&1`

Cloudflare: proxy laranja em tudo; SSL "Full (strict)"; cache rule para `/data/*` com Edge TTL 5s
(respeitando `stale-while-revalidate`); cache total para `/assets/*`; rate limiting na regra free em `POST /api/guess`.

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
