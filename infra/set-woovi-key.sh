#!/usr/bin/env bash
# Liga o Super Chat em produção com a chave (AppID) da Woovi que está na área de transferência.
# No Mac: copie o AppID no painel da Woovi (botão de copiar) e rode ./infra/set-woovi-key.sh
# A chave vai direto do clipboard para o .env da VPS (não aparece na tela), a API reinicia e a chave é testada.
set -euo pipefail
HOST=${DEPLOY_HOST:-ubuntu@51.222.220.40}
KEY=${DEPLOY_KEY:-$HOME/.ssh/urnadigital_ovh}

key=$(pbpaste | tr -d '[:space:]')
if [ ${#key} -lt 40 ]; then
  echo "A área de transferência não tem um AppID da Woovi (copie pelo botão do painel e rode de novo)."
  exit 1
fi

printf '%s' "$key" | ssh -i "$KEY" -o IdentitiesOnly=yes "$HOST" 'set -e
cd /opt/apuracao
key=$(cat)
# produção: tira o WOOVI_API (o padrão é a API de produção) e troca o AppID
grep -v "^WOOVI_" .env > .env.tmp
printf "\nWOOVI_APP_ID=%s\n" "$key" >> .env.tmp
mv .env.tmp .env && chmod 600 .env
docker compose up -d api >/dev/null 2>&1
sleep 6
# 404 = chave aceita (a cobrança de teste não existe); 401/403 = chave recusada
code=$(docker compose exec -T api node -e "fetch(\"https://api.woovi.com/api/v1/charge/teste-de-chave\",{headers:{authorization:process.env.WOOVI_APP_ID}}).then(r=>console.log(r.status))")
echo "Woovi respondeu: $code"
curl -s http://127.0.0.1:8090/data/site.json -H "Host: urnadigital.online"; echo'
printf '' | pbcopy
echo 'Pronto: se a Woovi respondeu 404 e o site.json mostra "superchat":true, o Super Chat está no ar.'
