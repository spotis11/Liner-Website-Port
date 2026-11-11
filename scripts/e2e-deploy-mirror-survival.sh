#!/bin/bash
# E2E: deploy-cycle survival — the exact user complaint.
# 1. register a fresh account on the live server ("production stand-in")
# 2. run the platform's database-runtime-build.sh, which fetches the LIVE
#    mirror from the server via /api/db-mirror/latest
# 3. boot a FRESH container (empty db, only the packaged seed mirror)
# 4. prove /api/auth/me with the SAME access token still works there
set -u
cd /home/z/my-project
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "=== 1. register + sign in on the live server (:3000) ==="
REG=$(curl -s -X POST localhost:3000/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"mirror_e2e@test.dev","username":"mirror_e2e_user","displayName":"Mirror E2E","password":"supersecret123"}')
AT=$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('accessToken',''))" <<< "$REG")
if [ -n "$AT" ]; then
  ok "registered mirror_e2e_user, access token ${AT:0:12}..."
else
  # maybe the account already exists from a prior run — try login
  REG=$(curl -s -X POST localhost:3000/api/auth/login \
    -H 'content-type: application/json' \
    -d '{"email":"mirror_e2e@test.dev","password":"supersecret123"}')
  AT=$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('accessToken',''))" <<< "$REG")
  [ -n "$AT" ] && ok "logged in existing mirror_e2e_user" || bad "no session (register+login failed)"
fi

ME=$(curl -s localhost:3000/api/auth/me -H "authorization: Bearer $AT")
case "$ME" in
  *mirror_e2e_user*) ok "live /api/auth/me -> mirror_e2e_user";;
  *) bad "live /api/auth/me unexpected: $(head -c 120 <<< "$ME")";;
esac

echo "=== 2. deploy build: fetch the live mirror via /api/db-mirror/latest ==="
rm -rf /tmp/mirror-e2e && mkdir -p /tmp/mirror-e2e
BUILD_DIR=/tmp/mirror-e2e DB_MIRROR_SOURCE_URL=http://127.0.0.1:3000/api/db-mirror/latest \
  bash .zscripts/database-runtime-build.sh > /tmp/mirror-e2e/build.log 2>&1
if grep -q "accounts=" /tmp/mirror-e2e/build.log && grep -q "LIVE production state" /tmp/mirror-e2e/build.log; then
  ok "build fetched the live mirror: $(grep -o 'OK accounts=[0-9]* systemKeys=[0-9]*' /tmp/mirror-e2e/build.log | head -1)"
else
  bad "build did not fetch the live mirror:"; cat /tmp/mirror-e2e/build.log | grep -E "🗄️|⚠️|ℹ️|❌"
fi
SEED=/tmp/mirror-e2e/db/db-mirror-seed.json
[ -s "$SEED" ] && ok "seed mirror packaged ($(stat -c%s "$SEED") bytes)" || bad "seed mirror missing"

echo "=== 3. boot the FRESH container (:3100, empty db + seed only) ==="
ls /tmp/mirror-e2e/db/
DATABASE_URL="file:/tmp/mirror-e2e/db/custom.db" NODE_ENV=production PORT=3100 HOSTNAME=127.0.0.1 \
  nohup node .next/standalone/server.js > /tmp/mirror-e2e/server.log 2>&1 &
NEWPID=$!
sleep 6
curl -s -o /dev/null -w "fresh container -> HTTP %{http_code}\n" localhost:3100/api/health

echo "=== 4. same access token on the fresh container ==="
ME2=$(curl -s localhost:3100/api/auth/me -H "authorization: Bearer $AT")
case "$ME2" in
  *mirror_e2e_user*) ok "SURVIVED THE DEPLOY: still signed in as mirror_e2e_user";;
  *) bad "session lost on fresh container: $(head -c 160 <<< "$ME2")";;
esac
grep -o "restored [0-9]* row(s)*[^,]*" /tmp/mirror-e2e/server.log | head -1

echo "=== 5. negative: export endpoint rejects a bad key ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "x-db-mirror-key: wrongkey" localhost:3000/api/db-mirror/latest)
[ "$CODE" = "403" ] && ok "bad key -> 403" || bad "bad key got $CODE (want 403)"

kill "$NEWPID" 2>/dev/null
echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
