#!/usr/bin/env bash
# Deploy na VPS (roda lá, em /opt/apuracao). O GitHub Actions chama a cada push na main; à mão também serve:
#   ./infra/deploy.sh                 a main do GitHub
#   ./infra/deploy.sh <branch|commit>  uma versão específica (ex.: voltar para um commit anterior)
#   ./infra/deploy.sh rollback        a versão que estava no ar antes do último deploy
#   ./infra/deploy.sh --only api [ref] só esses serviços (separados por vírgula: api,poller,caddy,ws1,ws2)
# Builda com os containers no ar, troca, confere a saúde e, se falhar, volta sozinho para a versão anterior.
# Os workers WS (o chat de todo mundo) só reiniciam se o código deles mudou, um de cada vez.
# Só mexe no projeto "apuracao" do docker compose (os outros projetos da máquina não são tocados).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p var

exec 9>var/deploy.lock
flock -n 9 || { echo "outro deploy em andamento"; exit 1; }

log() { echo "$(date '+%F %T') $*" | tee -a var/deploy.log; }

only=
if [ "${1:-}" = --only ]; then
  only=${2:?"--only precisa da lista de serviços"}
  shift 2
fi
ref=${1:-main}
cur=$(git rev-parse HEAD)
full=
if [ "$ref" = rollback ]; then
  full=1
  ref=$(cat var/deploy.prev 2>/dev/null) || { log "sem versão anterior registrada"; exit 1; }
fi

git fetch --quiet origin
# nome de branch vale a do GitHub (origin/<nome>); senão, commit
target=$(git rev-parse --verify -q "origin/$ref^{commit}" || git rev-parse --verify "$ref^{commit}")
log "deploy $(git log -1 --format='%h %s' "$target") (no ar: ${cur:0:7})"

# o que muda o WS (ou a forma de subir os containers): só aí os workers reiniciam
WS_PATHS=(apps/ws/src apps/ws/package.json packages pnpm-lock.yaml package.json Dockerfile docker-compose.yml infra/compose.ovh.yml)
ws_changed() { [ -n "$full" ] || ! git diff --quiet "$1" "$2" -- "${WS_PATHS[@]}"; }

up() {
  local from
  from=$(git rev-parse HEAD)
  git reset --quiet --hard "$1"
  if [ -n "$only" ]; then
    # shellcheck disable=SC2086
    docker compose build --quiet ${only//,/ }
    # shellcheck disable=SC2086
    docker compose up -d --no-deps ${only//,/ }
    return
  fi
  docker compose build --quiet
  local rest
  rest=$(docker compose config --services | grep -vx 'ws[0-9]*' | tr '\n' ' ')
  # --no-deps: sem isso o compose recriaria os workers junto, por serem dependência do Caddy
  # shellcheck disable=SC2086
  docker compose up -d --no-deps --remove-orphans $rest
  if ws_changed "$from" "$1"; then
    # um worker por vez: quem estava nele reconecta no outro (o nginx manda para o de menos conexões)
    local first=1
    for w in $(docker compose config --services | grep -x 'ws[0-9]*'); do
      [ -z "$first" ] && sleep 20
      first=
      log "reiniciando $w"
      docker compose up -d --no-deps "$w"
    done
  else
    log "WS sem mudança: workers seguem no ar"
  fi
}

healthy() {
  # API e WS respondendo por dentro da rede do compose, e o site pelo Caddy
  for _ in $(seq 30); do
    if docker compose exec -T api node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null &&
      docker compose exec -T ws1 node -e "fetch('http://127.0.0.1:3002/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

if up "$target" && healthy; then
  [ "$target" != "$cur" ] && echo "$cur" > var/deploy.prev
  log "ok: $(git log -1 --format='%h' HEAD) no ar"
  docker image prune -f --filter "label=com.docker.compose.project=apuracao" > /dev/null 2>&1 || true
  exit 0
fi

log "FALHOU: voltando para ${cur:0:7}"
full=1
up "$cur" && healthy && log "voltou para ${cur:0:7}" || log "ATENÇÃO: a versão anterior também não ficou saudável"
exit 1
