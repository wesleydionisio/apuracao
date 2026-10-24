#!/usr/bin/env bash
# Uma linha por minuto em var/metrics.log, para saber depois por que algo caiu. Cron:
#   * * * * * cd /opt/apuracao && ./infra/metrics.sh
# Colunas: hora, por worker (conexões, heap MB, msgs/s saindo, chat cheio), memória livre (MB), load, conntrack.
set -u
cd "$(dirname "$0")/.."
line="$(date '+%F %T')"
for p in 3012 3013; do
  m=$(curl -s -m 3 "http://127.0.0.1:$p/metrics" || true)
  get() { echo "$m" | awk -v k="$1" '$1==k {print $2}'; }
  line+=" ws$p conns=$(get ws_connections) heap=$(get ws_heap_mb) out/s=$(get ws_msgs_out_per_s) busy=$(get ws_chat_busy_total)"
done
line+=" mem_avail=$(free -m | awk '/^Mem:/ {print $7}') load=$(cut -d' ' -f1 /proc/loadavg)"
line+=" conntrack=$(cat /proc/sys/net/netfilter/nf_conntrack_count 2>/dev/null || echo -)"
echo "$line" >> var/metrics.log
