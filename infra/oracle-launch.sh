#!/usr/bin/env bash
# Fica tentando criar a VM ARM Always Free na Oracle até sair capacidade em São Paulo.
# Usa a config do OCI CLI (~/.oci/config). Rodar no Mac, em segundo plano:
#   caffeinate -i nohup ./infra/oracle-launch.sh >> var/oracle-launch.log 2>&1 &
set -u
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
mkdir -p var

NAME=apuracao
TENANCY=ocid1.tenancy.oc1..aaaaaaaadx3o34mc2h4p7kk27ozb63pv3khgzhsq6ivvju7sxcqd3wnokqga
AD="oOCT:SA-SAOPAULO-1-AD-1"
SUBNET=ocid1.subnet.oc1.sa-saopaulo-1.aaaaaaaa33kqhn3kko5wlwylqyeyklnwpuv4a7iqqqrbpl4m6reaysyov74a
SHAPE=VM.Standard.A1.Flex
OCPUS=2       # limite Always Free da conta: 2 OCPU / 12 GB
MEMORY_GB=12
SSH_PUB="$HOME/.ssh/oracle_vps.pub"
INTERVAL=60   # segundos entre tentativas

notify() {
  echo "$(date "+%F %T") $1"
  osascript -e "display notification \"$1\" with title \"Oracle VPS\" sound name \"Glass\"" 2>/dev/null
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -s -m 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=$1" > /dev/null
  fi
}

# Ubuntu 24.04 ARM mais recente
IMAGE=$(oci compute image list -c "$TENANCY" --operating-system "Canonical Ubuntu" \
  --operating-system-version "24.04" --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC \
  --limit 1 --query 'data[0].id' --raw-output 2>/dev/null)
[ -z "$IMAGE" ] && { echo "$(date "+%F %T") não achei a imagem Ubuntu 24.04 ARM"; exit 1; }

attempt=0
while true; do
  # não cria duplicada se uma tentativa anterior já pegou a VM
  existing=$(oci compute instance list -c "$TENANCY" --display-name "$NAME" \
    --query "data[?\"lifecycle-state\"!='TERMINATED'].id | [0]" --raw-output 2>/dev/null)
  if [ -n "$existing" ] && [ "$existing" != "null" ]; then
    id=$existing
    break
  fi

  attempt=$((attempt + 1))
  out=$(oci --no-retry compute instance launch -c "$TENANCY" --availability-domain "$AD" \
    --display-name "$NAME" --shape "$SHAPE" \
    --shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEMORY_GB}" \
    --image-id "$IMAGE" --subnet-id "$SUBNET" --assign-public-ip true \
    --ssh-authorized-keys-file "$SSH_PUB" \
    --query 'data.id' --raw-output 2>&1)

  if [[ "$out" == ocid1.instance.* ]]; then
    id=$out
    break
  fi

  case "$out" in
    *"Out of host capacity"*|*"Out of capacity"*|*InternalError*)
      echo "$(date "+%F %T") tentativa $attempt: sem capacidade"; sleep "$INTERVAL" ;;
    *TooManyRequests*)
      echo "$(date "+%F %T") tentativa $attempt: rate limit, esperando mais"; sleep $((INTERVAL * 3)) ;;
    *)
      notify "erro inesperado na tentativa $attempt: $(echo "$out" | tr '\n' ' ' | head -c 300)"
      exit 1 ;;
  esac
done

for _ in $(seq 60); do
  state=$(oci compute instance get --instance-id "$id" --query 'data."lifecycle-state"' --raw-output 2>/dev/null)
  [ "$state" = RUNNING ] && break
  sleep 10
done
ip=$(oci compute instance list-vnics --instance-id "$id" --query 'data[0]."public-ip"' --raw-output 2>/dev/null)
notify "✅ VM $NAME criada! IP: $ip — ssh -i ~/.ssh/oracle_vps ubuntu@$ip"
