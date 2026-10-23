#!/usr/bin/env bash
# Kill switches (a rota de admin não é exposta pelo Caddy; roda por dentro do container da API).
#   ./infra/flag.sh chat false          desliga o chat inteiro
#   ./infra/flag.sh projection false    esconde a projeção
#   ./infra/flag.sh map_mun false       desliga o mapa municipal
#   ./infra/flag.sh closeRoom sp        fecha a sala #sp     (openRoom sp reabre)
set -eu
cd "$(dirname "$0")/.."
key=$1; val=$2
case "$key" in closeRoom|openRoom) json="{\"$key\":\"$val\"}";; *) json="{\"$key\":$val}";; esac
docker compose exec -T api node -e "
fetch('http://127.0.0.1:3001/api/admin/flags',{method:'POST',headers:{'content-type':'application/json','x-admin-token':process.env.ADMIN_TOKEN},body:process.argv[1]})
  .then(r=>r.text()).then(t=>console.log(t))" "$json"
