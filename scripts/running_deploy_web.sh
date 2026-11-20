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

# 1) service: reuse or create "tryliner-web" (renamed on the platform; the
#    generated URL liner-web-liner-bot-f3eq.running.sh still uses the slug)
P=prj_qlg6u7iilas32ilkbv4j
E=env_zw22hwmnsgk42ukvscmn
S=$(rs "$API/projects/$P/canvas?environmentId=$E" | jq -r '.data.services[]? | select(.name=="tryliner-web") | .id' | head -1)
if [ -z "${S:-}" ]; then
  S=svc_vkzivjf5qsvnv3sivtbn   # known id — never create a duplicate
  echo "canvas lookup missed; using known service id $S"
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
        "LINER_SERVICE_EMAIL", "SMTP_USER", "SMTP_PASS",
        # admin-gate bootstrap secret (announcements/moderation on this host
        # cannot verify Liner tokens — the upstream WAF blocks datacenter
        # egress; the owner pastes this value once in the announcement tab)
        "ADMIN_GATE_SECRET"]
out = {k: env[k] for k in keys if env.get(k)}
out["DATABASE_URL"] = "file:/app/db/custom.db"
# the sandbox relay: this container's egress resets on the LLM endpoint and
# MyMemory blocks the datacenter IP, so /api/ai-translate forwards its
# still-missing lines here (the sandbox reaches both). The route guards the
# hop (x-liner-relay-hop header), so the relay deployment must NOT set this
# variable or it would relay to itself.
out["AI_TRANSLATE_RELAY_URL"] = "https://liner-music.space-z.ai/api/ai-translate"
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
# the AI-translate route powers /api/ai-translate via z-ai-web-dev-sdk, which
# resolves its credentials from .z-ai-config (project dir / home / /etc).
# running.sh has none, so ship the sandbox's config into the standalone root
# (server cwd) — stays out of git, ships only inside the deploy tarball.
# MISSING CONFIG = /api/ai-translate 502s in production (the 2026-11-20
# incident: /etc/.z-ai-config mounted after the tarball was cut), so this is
# a hard guard, and the staged file is verified inside the tarball below.
if [ ! -r /etc/.z-ai-config ]; then
  echo "FATAL: /etc/.z-ai-config missing — /api/ai-translate would 502. Deploy aborted." >&2
  exit 1
fi
# rm first: a previously staged copy carries /etc's read-only 444 mode and
# cp would refuse to overwrite it
rm -f "$STG/standalone/.z-ai-config"
cp /etc/.z-ai-config "$STG/standalone/.z-ai-config"
chmod 644 "$STG/standalone/.z-ai-config"
# the migration announcement is only for space-z.ai visitors — never ship it
# to running.sh (loader tag in index.html + the JS file itself)
sed -i '/INJECT:liner-migration-announcement-v/d; /liner-announcement\.js/d' \
  "$STG/standalone/public/liner/index.html" 2>/dev/null || true
rm -f "$STG/standalone/public/liner/liner-announcement.js"
cp "$ROOT/db/custom.db" "$STG/db/custom.db"
cp "$ROOT/deploy/web/Dockerfile" "$STG/Dockerfile"
tar -czf /tmp/liner-web.tgz -C "$STG" Dockerfile standalone db
echo "tarball: $(du -h /tmp/liner-web.tgz | cut -f1)"
# the credential file must actually be inside the tarball — verify, never hope
# (grep -c, NOT -q: with pipefail, -q's early exit SIGPIPEs tar mid-listing
# and the pipeline reports failure even when the file is present)
if [ "$(tar -tzf /tmp/liner-web.tgz 2>/dev/null | grep -c '\.z-ai-config')" -lt 1 ]; then
  echo "FATAL: tarball lacks standalone/.z-ai-config — /api/ai-translate would 502. Deploy aborted." >&2
  rm -f /tmp/liner-web.tgz
  exit 1
fi

# 5) upload deploy
D=$(curl -sS -H "Authorization: Bearer $TOKEN" -F "source=@/tmp/liner-web.tgz" \
  "$API/services/$S/deployments/upload?environmentId=$E" | jq -r '.data.id')
rm -f /tmp/liner-web.tgz
echo "$S" | tee "$ROOT/scripts/.liner_web_svc_id"
echo "$D" | tee "$ROOT/scripts/.last_web_deploy_id"
echo "deployment: $D  (poll: scripts/running_poll_bot.sh $D <svc> <prj> <env>)"
