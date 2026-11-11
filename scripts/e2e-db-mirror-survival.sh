#!/usr/bin/env bash
# Verify the full-database mirror end to end:
#  1. guest login -> runtime mirror written within the debounce window
#  2. FC-reset simulation: kill server, DELETE db/custom.db, restart
#     -> session from before must still authenticate (mirror restore)
#  3. over-unpack simulation: db present with data -> restore must NOT run
set -uo pipefail
BASE="http://localhost:3000"
DB="/home/z/my-project/db/custom.db"
MIRROR="/home/z/my-project/db/db-mirror.json"
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

start_server() {
  nohup node /home/z/my-project/.next/standalone/server.js > /tmp/liner-prod.log 2>&1 &
  echo $! > /tmp/liner-prod.pid
  sleep 4
  curl -s -o /dev/null "$BASE"
}

# step 0: make sure a server is up
curl -s -o /dev/null --max-time 2 "$BASE" || start_server
sleep 1

echo "=== 1. guest login -> runtime mirror written ==="
LOGIN=$(curl -s -X POST "$BASE/api/auth/guest" -H "Content-Type: application/json" -d '{}')
AT=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('accessToken',''))" "$LOGIN")
RT=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('refreshToken',''))" "$LOGIN")
[ -n "$AT" ] && ok "guest session minted" || { bad "no tokens: $LOGIN"; exit 1; }
sleep 3.5   # 2s debounce + margin
if [ -s "$MIRROR" ]; then
  ROWS=$(python3 -c "import json; d=json.load(open('$MIRROR')); print(len(d['tables']['account']), 'accounts,', len(d['tables']['session']), 'sessions')")
  ok "runtime mirror written ($ROWS)"
else
  bad "runtime mirror missing after login"
fi

echo "=== 2. FC-reset simulation: delete the db file, restart, old token must live ==="
kill "$(cat /tmp/liner-prod.pid)" 2>/dev/null; sleep 2
rm -f "$DB"
rm -f "$DB-journal" 2>/dev/null
start_server
ME=$(curl -s "$BASE/api/auth/me" -H "Authorization: Bearer $AT")
if echo "$ME" | grep -q '"username"'; then
  ok "access token valid after FULL db wipe (mirror restored the session)"
else
  bad "session lost after db wipe: $ME"
fi
REFRESH=$(curl -s -X POST "$BASE/api/auth/refresh" -H "Content-Type: application/json" -d "{\"refreshToken\": \"$RT\"}")
if echo "$REFRESH" | grep -q '"accessToken"'; then
  ok "refresh token valid after FULL db wipe (rotation works on restored row)"
  NEWAT=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('accessToken',''))" "$REFRESH")
else
  bad "refresh rejected after db wipe: $REFRESH"
fi
grep -q "restored .* row(s) from the database mirror" /tmp/liner-prod.log \
  && ok "restore logged by the runtime" || bad "restore not logged"

echo "=== 3. over-unpack simulation: db present with data -> no restore ==="
USER2=$(curl -s "$BASE/api/auth/me" -H "Authorization: Bearer $AT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('username','?'))" 2>/dev/null)
kill "$(cat /tmp/liner-prod.pid)" 2>/dev/null; sleep 2
: > /tmp/liner-prod.log
start_server
if grep -q "restored .* row(s) from the database mirror" /tmp/liner-prod.log; then
  bad "restore ran on a NON-fresh db (must be skipped)"
else
  ok "restore skipped — live db wins"
fi
ME3=$(curl -s "$BASE/api/auth/me" -H "Authorization: Bearer ${NEWAT:-$AT}")
echo "$ME3" | grep -q '"username"' && ok "session still valid after plain restart" || bad "plain restart lost the session: $ME3"

echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
