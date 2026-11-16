#!/bin/bash
# Deploy liner-bot to running.sh as a container service (project "liner-bot").
# Secrets come from liner-bot/.env and are set as encrypted service variables —
# never printed, never in the tarball.
set -euo pipefail

API="${RUNNING_API_URL:-https://running.sh}/api/v1"
TOKEN=$(cat /home/z/my-project/.secrets/running_token)
rs() { curl -sS -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" "$@"; }

WS=ws_l36mk7gxftaj4cad3avn

# 1) project: reuse or create "liner-bot"
P=$(rs "$API/workspaces/$WS/projects" | jq -r '.data[]? | select(.name=="liner-bot") | .id' | head -1)
if [ -z "${P:-}" ]; then
  P=$(rs -X POST "$API/projects" -d "{\"workspaceId\":\"$WS\",\"name\":\"liner-bot\"}" | jq -r '.data.id')
  echo "created project $P"
fi
echo "project: $P"

# 2) production environment
E=$(rs "$API/projects/$P/environments" | jq -r '.data[] | select(.kind=="production") | .id')
echo "environment: $E"

# 3) service: reuse or create "liner-bot" (upload source)
S=$(rs "$API/projects/$P/canvas?environmentId=$E" | jq -r '.data.services[]? | select(.name=="liner-bot") | .id' | head -1)
if [ -z "${S:-}" ]; then
  S=$(rs -X POST "$API/projects/$P/services" -d '{"name":"liner-bot","source":{"type":"upload"}}' | jq -r '.data.id')
  echo "created service $S"
fi
echo "service: $S"

# 4) container settings: health check + max anti-sleep window (free plan)
rs -X PATCH "$API/services/$S" \
  -d '{"port":3000,"healthcheckPath":"/health","healthcheckTimeoutSeconds":300,"sleepAfterSeconds":1800}' \
  | jq -c '{port: .data.port, healthcheck: .data.healthcheckPath, sleepAfterSeconds: .data.sleepAfterSeconds}'

# 5) variables — secrets read from liner-bot/.env (gitignored), never printed,
#    never hardcoded here
BT=$(grep -E '^DISCORD_BOT_TOKEN=' /home/z/my-project/liner-bot/.env | head -1 | cut -d= -f2- || true)
CI=$(grep -E '^DISCORD_CLIENT_ID=' /home/z/my-project/liner-bot/.env | head -1 | cut -d= -f2- || true)
CS=$(grep -E '^DISCORD_CLIENT_SECRET=' /home/z/my-project/liner-bot/.env | head -1 | cut -d= -f2- || true)
if [ -z "$BT" ] || [ -z "$CI" ] || [ -z "$CS" ]; then
  echo "ERROR: liner-bot/.env is missing DISCORD_BOT_TOKEN / DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET" >&2
  exit 1
fi
jq -n --arg bt "$BT" --arg ci "$CI" --arg cs "$CS" '{set:{
  DISCORD_BOT_TOKEN: $bt,
  DISCORD_CLIENT_ID: $ci,
  DISCORD_CLIENT_SECRET: $cs,
  DISCORD_CHANNEL_ID: "1570718488283324417",
  ANNOUNCE_CHANNEL_ID: "1570718488283324417",
  BOT_PRESENCE: "liner-music.space-z.ai",
  CLONE_URL: "https://github.com/spotis11/Liner-Website-Port.git",
  WATCH_REPO_DIR: "/app/repo",
  WATCH_REMOTE: "origin",
  WATCH_BRANCH: "main",
  WATCH_POLL_MS: "60000"
}}' > /tmp/liner_bot_vars.json
echo "variables set (names only):"
rs -X PATCH "$API/services/$S/variables?environmentId=$E" --data-binary @/tmp/liner_bot_vars.json \
  | jq -r '(.data[]?.name) // .'
rm -f /tmp/liner_bot_vars.json

# 6) upload deploy (source only — no .env, no node_modules, no data)
tar -czf /tmp/liner-bot-src.tgz -C /home/z/my-project/liner-bot Dockerfile index.js package.json package-lock.json
D=$(curl -sS -H "Authorization: Bearer $TOKEN" -F "source=@/tmp/liner-bot-src.tgz" \
  "$API/services/$S/deployments/upload?environmentId=$E" | jq -r '.data.id')
rm -f /tmp/liner-bot-src.tgz
echo "$D" | tee /home/z/my-project/scripts/.last_bot_deploy_id
echo "deployment: $D  (poll with scripts/running_poll_bot.sh)"
