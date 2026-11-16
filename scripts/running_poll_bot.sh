#!/bin/bash
# Poll a running.sh deployment until it finishes, then show domain + health + logs.
# Usage: running_poll_bot.sh <deployment-id>
set -euo pipefail

API="${RUNNING_API_URL:-https://running.sh}/api/v1"
TOKEN=$(cat /home/z/my-project/.secrets/running_token)
rs() { curl -sS -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" "$@"; }

D=${1:?deployment id required}
S=svc_tbshccvh7ahhfygk5h6z
P=prj_qlg6u7iilas32ilkbv4j
E=env_zw22hwmnsgk42ukvscmn

ST=""
for i in $(seq 1 28); do
  ST=$(rs "$API/deployments/$D" | jq -r '.data.status')
  echo "$(date +%T) $ST"
  case "$ST" in active|failed|canceled) break ;; esac
  sleep 10
done

if [ "$ST" != "active" ]; then
  echo "--- deployment error ---"
  rs "$API/deployments/$D" | jq -r '.data.error // .data | tostring' | head -20
  echo "--- build logs (tail) ---"
  rs "$API/deployments/$D/logs" | jq -r '.data[]? | "\(.level) \(.message)"' | tail -40
  exit 1
fi

echo "--- active. domain ---"
DOM=$(rs "$API/services/$S/domains?environmentId=$E" | jq -r '.data[] | select(.status=="active") | .hostname' | head -1)
if [ -z "${DOM:-}" ]; then
  DOM=$(rs "$API/services/$S/domains?environmentId=$E" | jq -r '.data[0].hostname // ""')
fi
echo "domain: ${DOM:-<none>}"
if [ -n "${DOM:-}" ]; then
  echo "https://$DOM"
  echo "--- /health ---"
  curl -sS --max-time 15 "https://$DOM/health" | jq . || echo "(health not answering yet)"
fi

echo "--- runtime logs (tail) ---"
rs "$API/services/$S/logs?environmentId=$E&limit=40" | jq -r '.data[]? | "\(.ts) \(.level) \(.message)"' | tail -25
