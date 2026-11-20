#!/bin/bash
# Deploy liner-bot to running.sh as a container service (project "liner-bot").
# Secrets come from liner-bot/.env and are set as encrypted service variables —
# never printed, never in the tarball.
set -euo pipefail

API="${RUNNING_API_URL:-https://running.sh}/api/v1"
TOKEN=$(cat /home/z/my-project/.secrets/running_token)
rs() { curl -sS -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" "$@"; }

# Pinned ids — the old name-lookup path once matched a different project with
# the same name and created a stray service. Never look up by name again.
P=prj_qlg6u7iilas32ilkbv4j            # project liner-bot
E=env_zw22hwmnsgk42ukvscmn            # production
S=svc_tbshccvh7ahhfygk5h6z            # service liner-bot
echo "project: $P / environment: $E / service: $S"

# 4) container settings: health check + max anti-sleep window (free plan)
rs -X PATCH "$API/services/$S" \
  -d '{"port":3000,"healthcheckPath":"/health","healthcheckTimeoutSeconds":300,"sleepAfterSeconds":1800}' \
  | jq -c '{port: .data.port, healthcheck: .data.healthcheckPath, sleepAfterSeconds: .data.sleepAfterSeconds}'

# 5) variables — secrets come from liner-bot/.env (gitignored) when it exists;
#    when it does not, the encrypted values already stored on the service are
#    reused and only the non-secret config is refreshed. Values never printed.
if [ -f /home/z/my-project/liner-bot/.env ]; then
  BT=$(grep -E '^DISCORD_BOT_TOKEN=' /home/z/my-project/liner-bot/.env | head -1 | cut -d= -f2- || true)
  CI=$(grep -E '^DISCORD_CLIENT_ID=' /home/z/my-project/liner-bot/.env | head -1 | cut -d= -f2- || true)
  CS=$(grep -E '^DISCORD_CLIENT_SECRET=' /home/z/my-project/liner-bot/.env | head -1 | cut -d= -f2- || true)
  if [ -n "$BT" ] && [ -n "$CI" ] && [ -n "$CS" ]; then
    jq -n --arg bt "$BT" --arg ci "$CI" --arg cs "$CS" '{set:{
      DISCORD_BOT_TOKEN: $bt,
      DISCORD_CLIENT_ID: $ci,
      DISCORD_CLIENT_SECRET: $cs
    }}' > /tmp/liner_bot_vars.json
    rs -X PATCH "$API/services/$S/variables?environmentId=$E" --data-binary @/tmp/liner_bot_vars.json \
      | jq -r '(.data[]?.name) // .'
    rm -f /tmp/liner_bot_vars.json
    echo "secret variables refreshed from liner-bot/.env"
  fi
fi
jq -n '{set:{
  DISCORD_CHANNEL_ID: "1570718488283324417",
  ANNOUNCE_CHANNEL_ID: "1570718488283324417",
  BOT_PRESENCE: "liner-music.space-z.ai",
  CLONE_URL: "https://github.com/spotis11/Liner-Website-Port.git",
  WATCH_REPO_SLUG: "spotis11/Liner-Website-Port",
  WATCH_REPO_DIR: "/app/repo",
  WATCH_REMOTE: "origin",
  WATCH_BRANCH: "main",
  WATCH_POLL_MS: "60000"
}}' > /tmp/liner_bot_vars.json
rs -X PATCH "$API/services/$S/variables?environmentId=$E" --data-binary @/tmp/liner_bot_vars.json \
  | jq -r '(.data[]?.name) // .'
rm -f /tmp/liner_bot_vars.json
echo "config variables set"

# 6) upload deploy (source only — no .env, no node_modules, no data)
tar -czf /tmp/liner-bot-src.tgz -C /home/z/my-project/liner-bot Dockerfile index.js commits.js package.json package-lock.json
D=$(curl -sS -H "Authorization: Bearer $TOKEN" -F "source=@/tmp/liner-bot-src.tgz" \
  "$API/services/$S/deployments/upload?environmentId=$E" | jq -r '.data.id')
rm -f /tmp/liner-bot-src.tgz
echo "$D" | tee /home/z/my-project/scripts/.last_bot_deploy_id
echo "deployment: $D  (poll with scripts/running_poll_bot.sh)"
