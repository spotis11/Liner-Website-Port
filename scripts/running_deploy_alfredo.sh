#!/bin/bash
# Deploy the Alfredo headless Discord bot (discord-bot/) to running.sh as a
# second service in the existing "liner-bot" project. Secrets come from
# alfredo.py's embedded DEFAULT_BOT_TOKEN (extracted, never printed) or the
# DISCORD_BOT_TOKEN env var — never hardcoded here.
set -euo pipefail

API="${RUNNING_API_URL:-https://running.sh}/api/v1"
TOKEN=$(cat /home/z/my-project/.secrets/running_token)
rs() { curl -sS -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" "$@"; }

P=prj_qlg6u7iilas32ilkbv4j            # project liner-bot
E=env_zw22hwmnsgk42ukvscmn            # production

# 1) service: reuse or create "alfredo-bot" (upload source).
#    (The original "alfredo" service hit a stale runtime-layer cache — its
#    container never received the tk/shim image layers; a fresh service gets a
#    clean base image.)
S=$(rs "$API/projects/$P/canvas?environmentId=$E" | jq -r '.data.services[]? | select(.name=="alfredo-bot") | .id' | head -1)
if [ -z "${S:-}" ]; then
  S=$(rs -X POST "$API/projects/$P/services" -d '{"name":"alfredo-bot","source":{"type":"upload"}}' | jq -r '.data.id')
  echo "created service $S"
fi
echo "service: $S"

# 2) container settings: health check + max anti-sleep window (free plan)
rs -X PATCH "$API/services/$S" \
  -d '{"port":3000,"healthcheckPath":"/health","healthcheckTimeoutSeconds":600,"sleepAfterSeconds":1800}' \
  | jq -c '{port: .data.port, healthcheck: .data.healthcheckPath, healthcheckTimeout: .data.healthcheckTimeoutSeconds, sleepAfterSeconds: .data.sleepAfterSeconds}'

# 3) variables — Alfredo's token, extracted silently, values never printed
BT=${DISCORD_BOT_TOKEN:-}
if [ -z "$BT" ]; then
  BT=$(grep -oE 'DEFAULT_BOT_TOKEN = "[^"]+"' /home/z/my-project/discord-bot/alfredo.py | head -1 | cut -d'"' -f2 || true)
fi
if [ -z "$BT" ]; then
  echo "ERROR: no Alfredo token (env DISCORD_BOT_TOKEN or alfredo.py DEFAULT_BOT_TOKEN)" >&2
  exit 1
fi
jq -n --arg bt "$BT" '{set:{DISCORD_BOT_TOKEN: $bt}}' > /tmp/alfredo_vars.json
echo "variables set (names only):"
rs -X PATCH "$API/services/$S/variables?environmentId=$E" --data-binary @/tmp/alfredo_vars.json \
  | jq -r '(.data[]?.name) // .'
rm -f /tmp/alfredo_vars.json

# 4) upload deploy (source only — no runtime artifacts, no logs)
tar -czf /tmp/alfredo-src.tgz -C /home/z/my-project/discord-bot \
  Dockerfile requirements.txt alfredo.py run_headless.py
D=$(curl -sS -H "Authorization: Bearer $TOKEN" -F "source=@/tmp/alfredo-src.tgz" \
  "$API/services/$S/deployments/upload?environmentId=$E" | jq -r '.data.id')
rm -f /tmp/alfredo-src.tgz
echo "$D" | tee /home/z/my-project/scripts/.last_alfredo_deploy_id
echo "deployment: $D  (poll: scripts/running_poll_bot.sh $D <svc> <prj> <env>)"
