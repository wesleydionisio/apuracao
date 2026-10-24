#!/usr/bin/env bash
# Alerta no celular (Telegram) quando algo da apuração sai do ar. Cron (a cada minuto):
#   * * * * * cd /opt/apuracao && ./infra/alert.sh >> var/alert.log 2>&1
# Confere o poller (snapshot parado >60s), a API e os dois workers WS (com Redis). Avisa uma vez por incidente
# e de novo quando volta.
set -u
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a

send() {
  echo "$(date -Is) $1"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -s -m 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=$1" > /dev/null
  fi
}

# check <nome> <url> <texto que a resposta saudável contém>
check() {
  local state="var/alert-$1.state" body
  body=$(curl -s -m 5 "$2" || true)
  if echo "$body" | grep -q "$3"; then
    [ -f "$state" ] && rm -f "$state" && send "✅ apuracao: $1 voltou ao normal"
  elif [ ! -f "$state" ]; then
    date > "$state"
    send "🚨 apuracao: $1 com problema — $(echo "${body:-sem resposta}" | head -c 300)"
  fi
}

check poller http://127.0.0.1:3003/health '"ok":true'
check api http://127.0.0.1:8090/api/health '"ok":true'
check ws1 http://127.0.0.1:3012/health '"redis":true'
check ws2 http://127.0.0.1:3013/health '"redis":true'
