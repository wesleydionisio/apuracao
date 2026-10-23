#!/usr/bin/env bash
# Alerta no celular se o poller ficar >60s sem atualizar. Cron (a cada minuto):
#   * * * * * cd /opt/apuracao && ./infra/alert.sh >> var/alert.log 2>&1
set -u
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a

state=var/alert.state
body=$(curl -s -m 5 http://127.0.0.1:3003/health || echo '{"ok":false,"lastError":"poller fora do ar"}')
if echo "$body" | grep -q '"ok":true'; then
  if [ -f "$state" ]; then
    rm -f "$state"
    msg="✅ apuracao: poller voltou ao normal"
  else
    exit 0
  fi
else
  # avisa uma vez por incidente, não a cada minuto
  [ -f "$state" ] && exit 0
  date > "$state"
  msg="🚨 apuracao: snapshot parado — $(echo "$body" | head -c 300)"
fi

echo "$(date -Is) $msg"
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  curl -s -m 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=${msg}" > /dev/null
fi
