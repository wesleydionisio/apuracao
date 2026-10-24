#!/usr/bin/env bash
# Deploy na VPS (roda lá, em /opt/apuracao). O GitHub Actions chama a cada push na main; à mão também serve:
#   ./infra/deploy.sh                 a main do GitHub
#   ./infra/deploy.sh <branch|commit>  uma versão específica (ex.: voltar para um commit anterior)
#   ./infra/deploy.sh rollback        a versão que estava no ar antes do último deploy
# Builda com os containers no ar, troca, confere a saúde e, se falhar, volta sozinho para a versão anterior.
# Só mexe no projeto "apuracao" do docker compose (os outros projetos da máquina não são tocados).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p var

exec 9>var/deploy.lock
flock -n 9 || { echo "outro deploy em andamento"; exit 1; }

log() { echo "$(date '+%F %T') $*" | tee -a var/deploy.log; }

ref=${1:-main}
cur=$(git rev-parse HEAD)
if [ "$ref" = rollback ]; then
  ref=$(cat var/deploy.prev 2>/dev/null) || { log "sem versão anterior registrada"; exit 1; }
fi

git fetch --quiet origin
# nome de branch vale a do GitHub (origin/<nome>); senão, commit
target=$(git rev-parse --verify -q "origin/$ref^{commit}" || git rev-parse --verify "$ref^{commit}")
log "deploy $(git log -1 --format='%h %s' "$target") (no ar: ${cur:0:7})"

up() {
  git reset --quiet --hard "$1"
  docker compose build --quiet
  docker compose up -d --remove-orphans
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
up "$cur" && healthy && log "voltou para ${cur:0:7}" || log "ATENÇÃO: a versão anterior também não ficou saudável"
exit 1
