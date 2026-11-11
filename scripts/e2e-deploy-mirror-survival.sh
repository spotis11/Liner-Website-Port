#!/bin/bash
# E2E: deploy-cycle survival — the exact user complaint ("logged out after
# every publish, account doesn't exist").
#
# FULLY ISOLATED on purpose: this test spins up its OWN server on :3100 with
# a scratch DATABASE_URL. Earlier versions registered test accounts on the
# shared :3000 server (workspace db) — and when a real deploy's build-time
# production fetch once failed, the build fell back to the workspace mirror
# and shipped those test accounts to production. Never again.
#
# 1. boot the "live" stand-in on :3100 (scratch db + its own export key)
# 2. register a fresh account there, verify /api/auth/me
# 3. run the platform's database-runtime-build.sh against :3100 -> seed
# 4. kill the server, DELETE its db (fresh container), reboot with the seed
# 5. prove /api/auth/me with the SAME access token still works there
# 6. restore endpoint: POST the seed minus one account -> that account's
#    token stops working, every other account survives
# 7. negative: export + restore endpoints reject a bad key
set -u
cd /home/z/my-project
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

SCRATCH=/tmp/mirror-e2e
PORT=3100
KEY="e2e-mirror-key-$RANDOM$RANDOM"
rm -rf "$SCRATCH" && mkdir -p "$SCRATCH/db"

boot_server() { # $1 = log file suffix
  DATABASE_URL="file:$SCRATCH/db/custom.db" \
  DB_MIRROR_EXPORT_KEY="$KEY" \
  NODE_ENV=production PORT=$PORT HOSTNAME=127.0.0.1 \
    nohup node .next/standalone/server.js > "$SCRATCH/server-$1.log" 2>&1 &
  echo $!
}

wait_healthy() {
  for _ in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 localhost:$PORT/api/health 2>/dev/null)" = "200" ] && return 0
    sleep 1
  done
  return 1
}

echo "=== 1. boot the live stand-in (:3100, scratch db) ==="
LIVE_PID=$(boot_server live)
wait_healthy || { bad "server did not come up"; tail -5 "$SCRATCH/server-live.log"; kill $LIVE_PID 2>/dev/null; exit 1; }
ok "live stand-in healthy on :$PORT (pid $LIVE_PID)"

echo "=== 2. register + sign in ==="
REG=$(curl -s -X POST localhost:$PORT/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"mirror_e2e@test.dev","username":"mirror_e2e_user","displayName":"Mirror E2E","password":"supersecret123"}')
AT=$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('accessToken',''))" <<< "$REG")
if [ -n "$AT" ]; then
  ok "registered mirror_e2e_user, access token ${AT:0:12}..."
else
  REG=$(curl -s -X POST localhost:$PORT/api/auth/login \
    -H 'content-type: application/json' \
    -d '{"email":"mirror_e2e@test.dev","password":"supersecret123"}')
  AT=$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('accessToken',''))" <<< "$REG")
  [ -n "$AT" ] && ok "logged in existing mirror_e2e_user" || { bad "no session (register+login failed)"; kill $LIVE_PID 2>/dev/null; exit 1; }
fi
# a second account that must SURVIVE the restore test in step 6
curl -s -X POST localhost:$PORT/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"mirror_e2e_keeper@test.dev","username":"mirror_e2e_keeper","displayName":"Keeper","password":"supersecret123"}' > /dev/null
ME=$(curl -s localhost:$PORT/api/auth/me -H "authorization: Bearer $AT")
case "$ME" in
  *mirror_e2e_user*) ok "live /api/auth/me -> mirror_e2e_user";;
  *) bad "live /api/auth/me unexpected: $(head -c 120 <<< "$ME")";;
esac

echo "=== 3. deploy build: fetch the live mirror via /api/db-mirror/latest ==="
BUILD_DIR="$SCRATCH" DB_MIRROR_SOURCE_URL="http://127.0.0.1:$PORT/api/db-mirror/latest" \
  DB_MIRROR_EXPORT_KEY="$KEY" \
  DB_MIRROR_CACHE_PATH="$SCRATCH/production-mirror-latest.json" \
  bash .zscripts/database-runtime-build.sh > "$SCRATCH/build.log" 2>&1
if grep -q "accounts=" "$SCRATCH/build.log" && grep -q "LIVE production state" "$SCRATCH/build.log"; then
  ok "build fetched the live mirror: $(grep -o 'OK accounts=[0-9]* systemKeys=[0-9]*' "$SCRATCH/build.log" | head -1)"
else
  bad "build did not fetch the live mirror:"; grep -E "🗄️|⚠️|ℹ️|❌|🛟|🚨" "$SCRATCH/build.log"
fi
SEED="$SCRATCH/db/db-mirror-seed.json"
[ -s "$SEED" ] && ok "seed mirror packaged ($(stat -c%s "$SEED") bytes)" || bad "seed mirror missing"

echo "=== 4. fresh container: same scratch dir, db deleted, seed only ==="
kill "$LIVE_PID" 2>/dev/null; sleep 1
rm -f "$SCRATCH/db/custom.db"
FRESH_PID=$(boot_server fresh)
wait_healthy || { bad "fresh container did not come up"; tail -5 "$SCRATCH/server-fresh.log"; kill $FRESH_PID 2>/dev/null; exit 1; }
ok "fresh container healthy (db restored from the seed)"
grep -o "restored [0-9]* row(s)*[^,]*" "$SCRATCH/server-fresh.log" | head -1

ME2=$(curl -s localhost:$PORT/api/auth/me -H "authorization: Bearer $AT")
case "$ME2" in
  *mirror_e2e_user*) ok "SURVIVED THE DEPLOY: still signed in as mirror_e2e_user";;
  *) bad "session lost on fresh container: $(head -c 160 <<< "$ME2")";;
esac

echo "=== 5. restore endpoint: replace state with the seed minus mirror_e2e_user ==="
python3 - "$SEED" "$SCRATCH/cleaned-mirror.json" <<'PYEOF'
import json, sys
src, out = sys.argv[1], sys.argv[2]
m = json.load(open(src))
m['tables']['account'] = [a for a in m['tables']['account'] if a['username'] != 'mirror_e2e_user']
m['tables']['session'] = [s for s in m['tables']['session'] if any(a['id'] == s['accountId'] for a in m['tables']['account'])]
json.dump(m, open(out, 'w'))
print(f"cleaned mirror: {len(m['tables']['account'])} account(s) left")
PYEOF
RC=$(curl -s -o "$SCRATCH/restore.json" -w "%{http_code}" -X POST localhost:$PORT/api/db-mirror/restore \
  -H "x-db-mirror-key: $KEY" -H 'content-type: application/json' \
  --data-binary @"$SCRATCH/cleaned-mirror.json")
[ "$RC" = "200" ] && ok "restore accepted (HTTP 200): $(head -c 200 "$SCRATCH/restore.json")" || bad "restore returned $RC: $(head -c 200 "$SCRATCH/restore.json")"

ME3=$(curl -s -o /dev/null -w "%{http_code}" localhost:$PORT/api/auth/me -H "authorization: Bearer $AT")
[ "$ME3" = "401" ] && ok "mirror_e2e_user token now invalid after restore (401)" || bad "removed account still authenticates ($ME3)"
KEEPER_LOGIN=$(curl -s -X POST localhost:$PORT/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"mirror_e2e_keeper@test.dev","password":"supersecret123"}')
case "$KEEPER_LOGIN" in
  *accessToken*) ok "surviving account still logs in after restore";;
  *) bad "surviving account broke after restore: $(head -c 160 <<< "$KEEPER_LOGIN")";;
esac

echo "=== 6. negative: both endpoints reject a bad key ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "x-db-mirror-key: wrongkey" localhost:$PORT/api/db-mirror/latest)
[ "$CODE" = "403" ] && ok "export: bad key -> 403" || bad "export: bad key got $CODE (want 403)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "x-db-mirror-key: wrongkey" -X POST localhost:$PORT/api/db-mirror/restore --data-binary '{}')
[ "$CODE" = "403" ] && ok "restore: bad key -> 403" || bad "restore: bad key got $CODE (want 403)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "x-db-mirror-key: $KEY" -X POST localhost:$PORT/api/db-mirror/restore --data-binary '{"savedAt":"x","tables":{}}')
[ "$CODE" = "400" ] && ok "restore: empty payload rejected -> 400" || bad "restore: empty payload got $CODE (want 400)"

kill "$FRESH_PID" 2>/dev/null
echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
