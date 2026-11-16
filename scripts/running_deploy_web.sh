#!/bin/bash
# Deploy the Liner web app (prebuilt Next.js standalone) to running.sh as a
# third service in the "liner-bot" project. Requires a completed build:
#   npm run build   (produces .next/standalone per package.json)
# Secrets come from the gitignored .env, extracted silently — never printed,
# never shipped inside the image (running.sh injects them as env vars).
set -euo pipefail

API="${RUNNING_API_URL:-https://running.sh}/api/v1"
TOKEN=$(cat /home/z/my-project/.secrets/running_token)
rs() { curl -sS -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" "$@"; }
ROOT=/home/z/my-project
STG=/tmp/liner-web-staging

envval() { grep -E "^$1=" "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d ' '; }

# 0) build guard
[ -f "$ROOT/.next/standalone/server.js" ] || { echo "no .next/standalone — run: npm run build" >&2; exit 1; }

# 1) service: reuse or create "liner-web"
P=prj_qlg6u7iilas32ilkbv4j
E=env_zw22hwmnsgk42ukvscmn
S=$(rs "$API/projects/$P/canvas?environmentId=$E" | jq -r '.data.services[]? | select(.name=="liner-web") | .id' | head -1)
if [ -z "${S:-}" ]; then
  S=$(rs -X POST "$API/projects/$P/services" -d '{"name":"liner-web","source":{"type":"upload"}}' | jq -r '.data.id')
  echo "created service $S"
fi
echo "service: $S"

# 2) container settings
rs -X PATCH "$API/services/$S" \
  -d '{"port":3000,"healthcheckPath":"/api/health","healthcheckTimeoutSeconds":600,"sleepAfterSeconds":1800}' \
  | jq -c '{port: .data.port, healthcheck: .data.healthcheckPath, healthcheckTimeout: .data.healthcheckTimeoutSeconds}'

# 3) variables — only keys actually present in .env (secrets lost in the
#    2026-11-16 workspace rebuild stay ABSENT so the runtime degrades exactly
#    as designed, never on empty strings); DATABASE_URL points at the
#    container path (the sandbox path is what .env carries locally)
python3 - > /tmp/liner-web-vars.json << 'PYEOF'
import json, re
env = {}
for line in open("/home/z/my-project/.env"):
    m = re.match(r"^([A-Z_]+)=(.*)$", line.strip())
    if m:
        env[m.group(1)] = m.group(2).strip().strip('"')
keys = ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DB_MIRROR_EXPORT_KEY",
        "LINER_SERVICE_EMAIL", "SMTP_USER", "SMTP_PASS"]
out = {k: env[k] for k in keys if env.get(k)}
out["DATABASE_URL"] = "file:/app/db/custom.db"
print(json.dumps({"set": out}))
PYEOF
echo "variables set (names only):"
rs -X PATCH "$API/services/$S/variables?environmentId=$E" --data-binary @/tmp/liner-web-vars.json \
  | jq -r '(.data[]?.name) // .'
rm -f /tmp/liner-web-vars.json

# 4) staging: standalone bundle WITHOUT .env (secrets), current DB, Dockerfile
rm -rf "$STG" && mkdir -p "$STG/db"
cp -r "$ROOT/.next/standalone" "$STG/standalone"
rm -f "$STG/standalone/.env"
cp "$ROOT/db/custom.db" "$STG/db/custom.db"
cp "$ROOT/deploy/web/Dockerfile" "$STG/Dockerfile"
tar -czf /tmp/liner-web.tgz -C "$STG" Dockerfile standalone db
echo "tarball: $(du -h /tmp/liner-web.tgz | cut -f1)"

# 5) upload deploy
D=$(curl -sS -H "Authorization: Bearer $TOKEN" -F "source=@/tmp/liner-web.tgz" \
  "$API/services/$S/deployments/upload?environmentId=$E" | jq -r '.data.id')
rm -f /tmp/liner-web.tgz
echo "$S" | tee "$ROOT/scripts/.liner_web_svc_id"
echo "$D" | tee "$ROOT/scripts/.last_web_deploy_id"
echo "deployment: $D  (poll: scripts/running_poll_bot.sh $D <svc> <prj> <env>)"
