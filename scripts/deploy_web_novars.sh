#!/bin/bash
# Deploy the Liner web app (prebuilt Next.js standalone) to running.sh —
# TRIMMED VARIANT of running_deploy_web.sh for the 2026-11-24 404 fix:
# identical staging + upload, but NO service-settings PATCH and NO
# variables PATCH. The platform already carries the full secret set
# (ADMIN_GATE_SECRET, DISCORD_CLIENT_SECRET, SMTP_*, DB_MIRROR_EXPORT_KEY,
# LINER_UPSTREAM_BASE, AI_TRANSLATE_RELAY_URL — verified via reveal=1) and
# the local .env holds only the recoverable subset, so PATCHing {"set": …}
# here risks dropping keys depending on the API's merge semantics.
# Requires a completed build: npm run build (produces .next/standalone).
set -euo pipefail

API="${RUNNING_API_URL:-https://running.sh}/api/v1"
TOKEN=$(cat /home/z/my-project/.secrets/running_token)
rs() { curl -sS -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" "$@"; }
ROOT=/home/z/my-project
STG=/tmp/liner-web-staging
P=prj_qlg6u7iilas32ilkbv4j
E=env_zw22hwmnsgk42ukvscmn
S=svc_vkzivjf5qsvnv3sivtbn

# 0) build guard
[ -f "$ROOT/.next/standalone/server.js" ] || { echo "no .next/standalone — run: npm run build" >&2; exit 1; }
echo "service: $S (settings + variables UNTOUCHED — platform state is authoritative)"

# 1) staging: standalone bundle WITHOUT .env (secrets), current DB, Dockerfile
rm -rf "$STG" && mkdir -p "$STG/db"
cp -r "$ROOT/.next/standalone" "$STG/standalone"
rm -f "$STG/standalone/.env"
# /api/ai-translate resolves z-ai credentials from .z-ai-config (missing =
# 502s — the 2026-11-20 incident). rm first: /etc's 444 mode blocks cp -f.
if [ ! -r /etc/.z-ai-config ]; then
  echo "FATAL: /etc/.z-ai-config missing — /api/ai-translate would 502. Deploy aborted." >&2
  exit 1
fi
rm -f "$STG/standalone/.z-ai-config"
cp /etc/.z-ai-config "$STG/standalone/.z-ai-config"
chmod 644 "$STG/standalone/.z-ai-config"
# migration announcement is only for space-z.ai visitors — never to running.sh
sed -i '/INJECT:liner-migration-announcement-v/d; /liner-announcement\.js/d' \
  "$STG/standalone/public/liner/index.html" 2>/dev/null || true
rm -f "$STG/standalone/public/liner/liner-announcement.js"
# freshest live db (restored from the production mirror — never the stale
# workspace copy: the Dockerfile COPY overwrites the container db on deploy)
cp "$ROOT/db/custom.db" "$STG/db/custom.db"
cp "$ROOT/deploy/web/Dockerfile" "$STG/Dockerfile"
tar -czf /tmp/liner-web.tgz -C "$STG" Dockerfile standalone db
echo "tarball: $(du -h /tmp/liner-web.tgz | cut -f1)"
# the credential file must actually be inside the tarball — verify, never hope
if [ "$(tar -tzf /tmp/liner-web.tgz 2>/dev/null | grep -c '\.z-ai-config')" -lt 1 ]; then
  echo "FATAL: tarball lacks standalone/.z-ai-config — /api/ai-translate would 502. Deploy aborted." >&2
  rm -f /tmp/liner-web.tgz
  exit 1
fi

# 2) upload deploy
D=$(curl -sS -H "Authorization: Bearer $TOKEN" -F "source=@/tmp/liner-web.tgz" \
  "$API/services/$S/deployments/upload?environmentId=$E" | jq -r '.data.id')
rm -f /tmp/liner-web.tgz
echo "$S" | tee "$ROOT/scripts/.liner_web_svc_id"
echo "$D" | tee "$ROOT/scripts/.last_web_deploy_id"
echo "deployment: $D  (poll: scripts/running_poll_bot.sh $D $S $P $E)"
