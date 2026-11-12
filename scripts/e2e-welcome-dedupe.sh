#!/bin/bash
# E2E: welcome-mail inbox dedupe (one welcome mail per email address, ever).
# Scratch db + :3100 — production/workspace never touched. SMTP is disabled
# via empty SMTP_HOST so no real mail can ever leave this test.
#
# Story being verified (the owner's bug): a deploy wipe eats the accounts but
# the audit table survives -> the same person re-registers with the same email
# under a new username -> the site must NOT welcome the same inbox twice.
set -u
cd /home/z/my-project
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

PORT=3100
SCRATCH=/tmp/dedupe-e2e
DB="$SCRATCH/db/custom.db"
B="http://127.0.0.1:$PORT"
rm -rf "$SCRATCH" && mkdir -p "$SCRATCH/db"

boot() { # $1 = log suffix
  DATABASE_URL="file:$DB" \
  DB_MIRROR_EXPORT_KEY="dedupe-e2e-key" \
  SMTP_HOST="" SMTP_PORT="" \
  NODE_ENV=production PORT=$PORT HOSTNAME=127.0.0.1 \
    nohup node .next/standalone/server.js > "$SCRATCH/server-$1.log" 2>&1 &
  echo $!
}
wait_healthy() {
  for _ in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 $B/api/health 2>/dev/null)" = "200" ] && return 0
    sleep 1
  done
  return 1
}
register() { # $1 email, $2 username, $3 displayName -> prints accessToken
  curl -s -X POST "$B/api/auth/register" -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"password9x\",\"username\":\"$2\",\"displayName\":\"$3\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null
}
probe() { # $1 username, $2 token (client-style moderation check)
  curl -s -X POST "$B/api/moderation/check" -H 'content-type: application/json' \
    -d "{\"username\":\"$1\",\"accessToken\":\"$2\"}" > /dev/null
}

echo "=== 1. boot scratch server (:3100, SMTP disabled) ==="
PID1=$(boot a)
wait_healthy || { bad "server did not come up"; kill $PID1 2>/dev/null; exit 1; }
ok "scratch server healthy (pid $PID1)"

echo "=== 2. register e2ea + trigger welcome (expect a logged attempt) ==="
AT1=$(register "dedupe@example.com" "e2ea" "E2E A")
[ -n "$AT1" ] && ok "registered e2ea" || bad "register e2ea failed"
probe "e2ea" "$AT1"
sleep 3
ROWS_A=$(python3 -c "
import sqlite3
print(sqlite3.connect('$DB').execute(\"SELECT COUNT(*) FROM emailLog WHERE username='e2ea'\").fetchone()[0])
")
[ "$ROWS_A" = "1" ] && ok "welcome attempt for e2ea audited (SMTP off -> failed row)" || bad "expected 1 e2ea row, got $ROWS_A"

echo "=== 3. simulate the wipe: account+session+userseen die, audit survives ==="
kill $PID1 2>/dev/null; sleep 2
python3 -c "
import sqlite3
con = sqlite3.connect('$DB')
con.execute(\"UPDATE emailLog SET status='sent' WHERE username='e2ea'\")   # the mail HAD landed once
con.execute(\"DELETE FROM Session WHERE accountId IN (SELECT id FROM Account WHERE username='e2ea')\")
con.execute(\"DELETE FROM Account WHERE username='e2ea'\")
con.execute(\"DELETE FROM UserSeen WHERE username='e2ea'\")
con.commit()
print('  surgery done: account gone, emailLog row status=sent kept')
"
rm -f "$SCRATCH/db/db-mirror.json"   # stop the runtime mirror from resurrecting the account
PID2=$(boot b)
wait_healthy || { bad "server did not reboot"; kill $PID2 2>/dev/null; exit 1; }
ok "server rebooted on the wiped db (pid $PID2)"

echo "=== 4. re-register SAME inbox, new username -> welcome must be SKIPPED ==="
AT2=$(register "dedupe@example.com" "e2eb" "E2E B")
[ -n "$AT2" ] && ok "registered e2eb (same email, new username)" || bad "register e2eb failed"
probe "e2eb" "$AT2"
sleep 3
ROWS_B=$(python3 -c "
import sqlite3
print(sqlite3.connect('$DB').execute(\"SELECT COUNT(*) FROM emailLog WHERE username='e2eb'\").fetchone()[0])
")
[ "$ROWS_B" = "0" ] && ok "NO new welcome attempt for e2eb (inbox already welcomed)" || bad "e2eb got its own row ($ROWS_B) — dedupe broken"
grep -q "welcome email to e2eb skipped: inbox already welcomed (as e2ea)" "$SCRATCH/server-b.log" \
  && ok "skip is visible in the server log" || bad "skip line missing from server log"

echo "=== 5. control: a DIFFERENT inbox still gets its welcome attempt ==="
AT3=$(register "fresh-inbox@example.com" "e2ec" "E2E C")
[ -n "$AT3" ] && ok "registered e2ec (different email)" || bad "register e2ec failed"
probe "e2ec" "$AT3"
sleep 3
ROWS_C=$(python3 -c "
import sqlite3
print(sqlite3.connect('$DB').execute(\"SELECT COUNT(*) FROM emailLog WHERE username='e2ec'\").fetchone()[0])
")
[ "$ROWS_C" = "1" ] && ok "e2ec's welcome attempt fired normally (dedupe is per-inbox only)" || bad "e2ec row missing — dedupe too broad"

kill $PID2 2>/dev/null
echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ] || exit 1
