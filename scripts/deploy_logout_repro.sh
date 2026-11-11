#!/usr/bin/env bash
# Reproduce "website update logs me out": mint a session, restart the prod
# server exactly like deploy.sh does, then probe /api/auth/me + refresh.
set -uo pipefail
BASE="http://localhost:3000"

echo "=== 1. mint a guest session ==="
LOGIN=$(curl -s -X POST "$BASE/api/auth/guest" -H "Content-Type: application/json" -d '{}')
AT=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('accessToken',''))" "$LOGIN" 2>/dev/null)
RT=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('refreshToken',''))" "$LOGIN" 2>/dev/null)
echo "  accessToken: ${AT:0:14}... refreshToken: ${RT:0:14}..."
[ -z "$AT" ] && { echo "  FAIL: no tokens minted: $LOGIN"; exit 1; }

ME1=$(curl -s "$BASE/api/auth/me" -H "Authorization: Bearer $AT")
echo "  me(before): $(echo "$ME1" | head -c 120)"

echo "=== 2. restart prod server (deploy-style) ==="
if [ -f /tmp/liner-prod.pid ]; then kill "$(cat /tmp/liner-prod.pid)" 2>/dev/null; sleep 2; fi
pkill -f "standalone/server.js" 2>/dev/null; sleep 1
cd /home/z/my-project
nohup node .next/standalone/server.js > /tmp/liner-prod.log 2>&1 &
echo $! > /tmp/liner-prod.pid
sleep 4
curl -s -o /dev/null -w "  server back: HTTP %{http_code}\n" "$BASE"

echo "=== 3. probe /api/auth/me with the SAME access token ==="
ME2=$(curl -s "$BASE/api/auth/me" -H "Authorization: Bearer $AT")
if echo "$ME2" | grep -q '"user"'; then
  echo "  PASS: access token still valid after restart: $(echo "$ME2" | head -c 100)"
else
  echo "  FAIL: access token rejected after restart: $ME2"
fi

echo "=== 4. refresh with the SAME refresh token ==="
REF=$(curl -s -X POST "$BASE/api/auth/refresh" -H "Content-Type: application/json" -d "{\"refreshToken\": \"$RT\"}")
if echo "$REF" | grep -q '"accessToken"'; then
  echo "  PASS: refresh worked after restart: $(echo "$REF" | head -c 100)"
else
  echo "  FAIL: refresh rejected after restart: $REF"
fi

echo "=== 5. sessions table row count before/after check ==="
node -e "
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
db.session.count().then((n) => { console.log('  session rows:', n); return db.\$disconnect(); });
" 2>/dev/null
