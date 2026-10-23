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

- **Calor** (padrão): os pontos viram um campo contínuo (desfoque em três escalas, a mais fina com dado
  suficiente vale), do vermelho ao azul passando pelo roxo; cinza onde nada foi apurado. Com zoom, o calor
  se resolve num mosaico de cidades (Voronoi dos pontos ≈ limites dos municípios). As contas rodam num
  worker (`apps/web/src/features/map/heat.worker.ts`).
- **Pontos**: o ponto acende quando o % apurado da cidade passa do sorteio fixo dele e ganha a cor de um
  candidato na proporção dos votos da cidade.
- Zoom e arrasto nos dois: pinça e dois dedos no celular (um dedo arrasta só com zoom, para não prender a
  rolagem), Ctrl/⌘ + rolagem no computador, duplo toque, botões e teclado.

Testes: `pnpm test`.

## Produção (VPS)

1. Kernel: `sudo cp infra/sysctl-apuracao.conf /etc/sysctl.d/99-apuracao.conf && sudo sysctl --system`
2. `cp .env.example .env` e preencha (`SECRET`, `ADMIN_TOKEN`, `POSTGRES_PASSWORD`, `SITE_HOST`, `PUBLIC_URL`).
3. `pnpm install && pnpm etl` (gera `public/data/static`, `apps/web/public/geo`, fontes dos cards).
4. `docker compose up -d --build`
5. Cron do alerta: `* * * * * cd /opt/apuracao && ./infra/alert.sh >> var/alert.log 2>&1`

Cloudflare: proxy laranja em tudo; SSL "Full (strict)"; cache rule para `/data/*` com Edge TTL 5s
(respeitando `stale-while-revalidate`); cache total para `/assets/*`; rate limiting na regra free em `POST /api/guess`.

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
