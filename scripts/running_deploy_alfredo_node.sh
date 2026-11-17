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

# 1b) ensure STORE_TOKEN service variable exists (gates GET /debug/store)
ST_TOKEN=$(cat /home/z/my-project/.secrets/alfredo_store_token)
if ! echo "$VARS" | jq -e '.data[]? | select(.name=="STORE_TOKEN")' >/dev/null; then
  jq -n --arg st "$ST_TOKEN" '{set:{STORE_TOKEN: $st}}' > /tmp/alfredo_vars.json
  rs -X PATCH "$API/services/$S/variables?environmentId=$E" --data-binary @/tmp/alfredo_vars.json | jq -r '(.data[]?.name) // .'
  rm -f /tmp/alfredo_vars.json
  echo "STORE_TOKEN set on service"
else
  echo "STORE_TOKEN already set on service"
fi

# 2) container settings (idempotent; lite instance is enough for Node)
rs -X PATCH "$API/services/$S" \
  -d '{"port":3000,"healthcheckPath":"/health","alwaysOn":true,"sleepAfterSeconds":1800}' \
  | jq -c '{port: .data.port, healthcheck: .data.healthcheckPath, alwaysOn: .data.alwaysOn}'

# 2b) PERSISTENCE: pull the LIVE store so runtime config (.prefix, tags, warns,
# economy, presence ...) survives into the next container as the seed.
# Only replace the seed when the live store is non-empty (never clobber a
# hand-baked seed with an empty fresh container).
BASE="https://alfredo-bot-liner-bot-pwdq.running.sh"
mkdir -p /home/z/my-project/alfredo-node/data
SEED=/home/z/my-project/alfredo-node/data/store-seed.json
if curl -sS --max-time 15 -o /tmp/alfredo_live_store.json "$BASE/debug/store?token=$ST_TOKEN" \
   && jq -e '(.prefixes // {} | length) + (.afk // {} | length) + (.tags // {} | length) + (.customcmds // {} | length) + (.warnings // {} | length) + (.cases // {} | length) + (.economy // {} | length) + (.shop // {} | length) + (.counting // {} | length) > 0' /tmp/alfredo_live_store.json >/dev/null 2>&1; then
  mv /tmp/alfredo_live_store.json "$SEED"
  echo "store seed captured from live container"
else
  echo "keeping existing seed (live store empty or unreachable)"
  rm -f /tmp/alfredo_live_store.json
fi

# 3) upload deploy (source only — node_modules comes from npm ci in the image)
cd /home/z/my-project/alfredo-node
tar -czf /tmp/alfredo-node-src.tgz --exclude=data/store.json --exclude='data/store.json.tmp' \
  Dockerfile package.json package-lock.json index.js lib data
D=$(curl -sS -H "Authorization: Bearer $TOKEN" -F "source=@/tmp/alfredo-node-src.tgz" \
  "$API/services/$S/deployments/upload?environmentId=$E" | jq -r '.data.id')
rm -f /tmp/alfredo-node-src.tgz
echo "$D" | tee /home/z/my-project/scripts/.last_alfredo_deploy_id
echo "deployment: $D  (poll: scripts/running_poll_bot.sh $D $S $P $E)"
