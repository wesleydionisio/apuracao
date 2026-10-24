# Uma imagem para api, ws e poller (mudam só o comando) + estágio de build do web para o Caddy.
FROM node:22-trixie-slim AS deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/ws/package.json apps/ws/
COPY apps/poller/package.json apps/poller/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/data/package.json packages/data/
RUN pnpm install --frozen-lockfile

FROM deps AS web-build
COPY . .
RUN pnpm --filter @apuracao/web build

FROM deps AS app
COPY . .
# o HTML das rotas compartilháveis sai da API a partir do index.html do build: tem de ser o mesmo build
# que o Caddy serve (um apps/web/dist velho na pasta apontaria para assets que não existem mais)
COPY --from=web-build /app/apps/web/dist apps/web/dist
ENV NODE_ENV=production
# comando definido no docker-compose (apps/<app>/node_modules/.bin/tsx apps/<app>/src/index.ts)

FROM caddy:2.8-alpine AS caddy
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/web/dist /srv/web
