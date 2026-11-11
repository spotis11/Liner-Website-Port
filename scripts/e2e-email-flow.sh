#!/bin/bash
# E2E: transactional emails (welcome on register) + boot-time retry sweep.
# Scratch db on :3100 — production/workspace never touched.
#
# 1. boot scratch server (Gmail SMTP env comes from the standalone .env)
# 2. register "mailtest" account, hit /api/moderation/check like the client
# 3. welcome email trigger fires -> EmailLog row (status reflects the real
#    Gmail attempt; from a datacenter IP Google usually 535s the auth)
# 4. mark the row's error with a sentinel, kill the server
# 5. reboot the SAME db, wait for the boot retry sweep
# 6. assert the sweep re-attempted the mail (sentinel error overwritten)
set -u
cd /home/z/my-project
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

PORT=3100
SCRATCH=/tmp/mail-e2e
rm -rf "$SCRATCH" && mkdir -p "$SCRATCH/db"

boot() { # $1 = log suffix
  DATABASE_URL="file:$SCRATCH/db/custom.db" \
  DB_MIRROR_EXPORT_KEY="mail-e2e-key" \
  NODE_ENV=production PORT=$PORT HOSTNAME=127.0.0.1 \
    nohup node .next/standalone/server.js > "$SCRATCH/server-$1.log" 2>&1 &
  echo $!
}
wait_healthy() {
  for _ in $(seq 1 40); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 localhost:$PORT/api/health 2>/dev/null)" = "200" ] && return 0
    sleep 1
  done
  return 1
}

echo "=== 1. boot scratch server (:3100) ==="
PID1=$(boot boot1)
wait_healthy || { bad "server did not come up"; tail -5 "$SCRATCH/server-boot1.log"; kill $PID1 2>/dev/null; exit 1; }
ok "scratch server healthy (pid $PID1)"
B="http://127.0.0.1:$PORT"

echo "=== 2. register + client-style moderation probe ==="
REG=$(curl -s -X POST "$B/api/auth/register" -H 'content-type: application/json' \
  -d '{"email":"mailtest@example.com","password":"password9x","username":"mailtest","displayName":"Mail Test"}')
AT=$(echo "$REG" | python3 -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null)
[ -n "$AT" ] && ok "registered mailtest" || bad "register failed: $REG"

curl -s -X POST "$B/api/moderation/check" -H 'content-type: application/json' \
  -d "{\"username\":\"mailtest\",\"accessToken\":\"$AT\"}" > /dev/null
sleep 3  # welcome email is fire-and-forget

echo "=== 3. EmailLog row after the trigger ==="
python3 - <<'PYEOF' || FAIL_ROWS=1
import sqlite3
db = sqlite3.connect('/tmp/mail-e2e/db/custom.db')
rows = db.execute("SELECT type, username, email, status, error FROM emailLog").fetchall()
print(f"  emailLog rows: {len(rows)}")
for r in rows:
    print(f"  {r[0]} user={r[1]} email={r[2]} status={r[3]} error={str(r[4])[:70]}")
assert rows and rows[0][0] == 'welcome' and rows[0][1] == 'mailtest', "no welcome row"
# any status is fine: 'sent' means Gmail accepted; 'failed' means it 535'd
print(f"  WELCOME_TRIGGER_OK status={rows[0][3]}")
PYEOF
[ "${FAIL_ROWS:-0}" != "1" ] && ok "welcome trigger fired + audited" || bad "no welcome emailLog row"

echo "=== 4. sentinel + shutdown + reboot ==="
python3 -c "
import sqlite3
db = sqlite3.connect('/tmp/mail-e2e/db/custom.db')
db.execute(\"UPDATE emailLog SET error='SENTINEL_OLD_FAILURE' WHERE type='welcome'\")
db.commit()"
kill $PID1 2>/dev/null; sleep 2
PID2=$(boot boot2)
wait_healthy || { bad "reboot failed"; tail -5 "$SCRATCH/server-boot2.log"; kill $PID2 2>/dev/null; exit 1; }
ok "rebooted same db (pid $PID2)"

echo "=== 5. wait for the boot retry sweep (15s defer + send time) ==="
sleep 22
SWEEP=$(grep -c "retry sweep" "$SCRATCH/server-boot2.log" || true)
SENTINEL=$(python3 -c "
import sqlite3
db = sqlite3.connect('/tmp/mail-e2e/db/custom.db')
r = db.execute(\"SELECT error, status FROM emailLog WHERE type='welcome'\").fetchone()
print((r[0] or '')[:80] if r else 'NO_ROW')")
echo "  sweep log lines: $SWEEP"
echo "  emailLog error now: $SENTINEL"
[ "$SWEEP" -ge 1 ] && ok "boot retry sweep ran" || bad "no retry sweep log line"
[ "$SENTINEL" != "SENTINEL_OLD_FAILURE" ] && [ "$SENTINEL" != "NO_ROW" ] \
  && ok "failed mail was re-attempted (sentinel overwritten)" || bad "sentinel untouched: $SENTINEL"

kill $PID2 2>/dev/null
echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "ALL GREEN" || exit 1
