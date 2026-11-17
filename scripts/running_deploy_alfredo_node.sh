#!/bin/bash
# Deploy the Alfredo Node edition (alfredo-node/) to running.sh — replaces the
# Python service that kept dying on the platform. The bot token already lives
# on the service variables; its value is never printed by this script.
set -euo pipefail

API="${RUNNING_API_URL:-https://running.sh}/api/v1"
TOKEN=$(cat /home/z/my-project/.secrets/running_token)
rs() { curl -sS -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" "$@"; }

P=prj_qlg6u7iilas32ilkbv4j            # project liner-bot
E=env_zw22hwmnsgk42ukvscmn            # production
S=svc_3euskcktn5cb64lhb3wx            # service alfredo-bot

# 1) ensure the bot token variable exists (output shows names only)
VARS=$(rs "$API/services/$S/variables?environmentId=$E")
if ! echo "$VARS" | jq -e '.data[]? | select(.name=="DISCORD_BOT_TOKEN")' >/dev/null; then
  BT=${DISCORD_BOT_TOKEN:-$(grep -oE 'DEFAULT_BOT_TOKEN = "[^"]+"' /home/z/my-project/upload/alfredo.py | head -1 | cut -d'"' -f2)}
  [ -n "${BT:-}" ] || { echo "ERROR: no Alfredo token available" >&2; exit 1; }
  jq -n --arg bt "$BT" '{set:{DISCORD_BOT_TOKEN: $bt}}' > /tmp/alfredo_vars.json
  rs -X PATCH "$API/services/$S/variables?environmentId=$E" --data-binary @/tmp/alfredo_vars.json | jq -r '(.data[]?.name) // .'
  rm -f /tmp/alfredo_vars.json
  echo "DISCORD_BOT_TOKEN set on service"
else
  echo "DISCORD_BOT_TOKEN already set on service"
fi

# 2) container settings (idempotent; lite instance is enough for Node)
rs -X PATCH "$API/services/$S" \
  -d '{"port":3000,"healthcheckPath":"/health","alwaysOn":true,"sleepAfterSeconds":1800}' \
  | jq -c '{port: .data.port, healthcheck: .data.healthcheckPath, alwaysOn: .data.alwaysOn}'

# 3) upload deploy (source only — node_modules comes from npm ci in the image)
cd /home/z/my-project/alfredo-node
tar -czf /tmp/alfredo-node-src.tgz Dockerfile package.json package-lock.json index.js lib
D=$(curl -sS -H "Authorization: Bearer $TOKEN" -F "source=@/tmp/alfredo-node-src.tgz" \
  "$API/services/$S/deployments/upload?environmentId=$E" | jq -r '.data.id')
rm -f /tmp/alfredo-node-src.tgz
echo "$D" | tee /home/z/my-project/scripts/.last_alfredo_deploy_id
echo "deployment: $D  (poll: scripts/running_poll_bot.sh $D $S $P $E)"
