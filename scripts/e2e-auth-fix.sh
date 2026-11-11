#!/bin/bash
# E2E for the "register 409 / login 401 confusion" fix + the add-password flow.
# FULLY ISOLATED: scratch db on :3100 (never touches the workspace/production db).
#
# Scenarios:
#  1. register a fresh account                         -> 200 + tokens
#  2. register again with the same email               -> 409 EMAIL_TAKEN
#  3. login with the correct password                  -> 200
#  4. login with a wrong password                      -> 401 INVALID_CREDENTIALS
#  5. login on a Discord-linked (passwordless) account -> 401 DISCORD_ONLY
#  6. register with the Discord account's username     -> 409 DISCORD_ONLY
#  7. register with the Discord account's email        -> 409 DISCORD_ONLY
#  8. /api/auth/me flags hasPassword=false on the Discord account
#  9. POST /api/auth/password (add password, no current) -> 200
# 10. login as the Discord account with the new password -> 200
# 11. change password: wrong current -> 403 WRONG_PASSWORD
# 12. change password: weak new      -> 400 WEAK_PASSWORD
# 13. change password: correct        -> 200, new password logs in
# 14. PATCH profile with a taken username -> 409 USERNAME_TAKEN (was a 500)
set -u
cd /home/z/my-project
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

PORT=3100
SCRATCH=/tmp/authfix-e2e
KEY="e2e-authfix-key"
rm -rf "$SCRATCH" && mkdir -p "$SCRATCH/db"

echo "=== boot scratch server (:3100, scratch db) ==="
DATABASE_URL="file:$SCRATCH/db/custom.db" \
DB_MIRROR_EXPORT_KEY="$KEY" \
NODE_ENV=production PORT=$PORT HOSTNAME=127.0.0.1 \
  nohup node .next/standalone/server.js > "$SCRATCH/server.log" 2>&1 &
SRV_PID=$!
for _ in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 localhost:$PORT/api/health 2>/dev/null)" = "200" ] && break
  sleep 1
done
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 localhost:$PORT/api/health 2>/dev/null)" = "200" ] \
  && ok "scratch server healthy (pid $SRV_PID)" || { bad "server did not come up"; tail -5 "$SCRATCH/server.log"; kill $SRV_PID 2>/dev/null; exit 1; }

B="http://127.0.0.1:$PORT"
jqpy() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1" 2>/dev/null; }

echo "=== 1. register a fresh account ==="
REG=$(curl -s -X POST "$B/api/auth/register" -H 'content-type: application/json' \
  -d '{"email":"tester@example.com","password":"hunter2hunter2","username":"tester","displayName":"Tester"}')
AT=$(jqpy "['accessToken']" <<< "$REG")
RT_JSON=$(jqpy "['user']['username']" <<< "$REG")
[ -n "$AT" ] && [ "$RT_JSON" = "tester" ] && ok "register -> 200, user tester" || bad "register failed: $REG"

echo "=== 2. register again with the same email ==="
DUP=$(curl -s -o /tmp/authfix-dup.json -w '%{http_code}' -X POST "$B/api/auth/register" -H 'content-type: application/json' \
  -d '{"email":"tester@example.com","password":"anotherpass99","username":"tester2","displayName":"T2"}')
DUPCODE=$(jqpy "['code']" < /tmp/authfix-dup.json)
[ "$DUP" = "409" ] && [ "$DUPCODE" = "EMAIL_TAKEN" ] \
  && ok "duplicate email -> 409 EMAIL_TAKEN" || bad "duplicate email: HTTP $DUP code $DUPCODE"

echo "=== 3/4. login correct + wrong ==="
GOOD=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"tester","password":"hunter2hunter2"}')
BADPW=$(curl -s -o /tmp/authfix-badpw.json -w '%{http_code}' -X POST "$B/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"tester","password":"wrongwrong99"}')
BADPWCODE=$(jqpy "['code']" < /tmp/authfix-badpw.json)
[ "$GOOD" = "200" ] && ok "correct login -> 200" || bad "correct login: HTTP $GOOD"
[ "$BADPW" = "401" ] && [ "$BADPWCODE" = "INVALID_CREDENTIALS" ] \
  && ok "wrong password -> 401 INVALID_CREDENTIALS" || bad "wrong password: HTTP $BADPW code $BADPWCODE"

echo "=== 5-8. Discord-linked (passwordless) account ==="
# insert directly into the scratch db: a Discord account with no passwordHash
python3 - <<'PYEOF'
import sqlite3, hashlib, datetime
db = sqlite3.connect('/tmp/authfix-e2e/db/custom.db')
now = datetime.datetime.utcnow().isoformat() + 'Z'
db.execute("INSERT INTO Account (id, email, username, displayName, discordId, isGuest, isPublic, showActivity, showHistory, showLikedTracks, participateLeaderboards, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ('dc_acct_1', 'discord.user@example.com', 'discorduser', 'Discord User', '1234567890abcdef', 0, 1, 1, 1, 1, 1, now, now))
raw = 'at_' + 'e2e'*16  # 64 chars, at_ prefix like real tokens
h = hashlib.sha256(raw.encode()).hexdigest()
db.execute("INSERT INTO Session (id, accountId, tokenHash, refreshHash, expiresAt, createdAt, lastSeenAt) VALUES (?,?,?,?,?,?,?)",
  ('dc_sess_1', 'dc_acct_1', h, hashlib.sha256(('rt_'+'e2e'*16).encode()).hexdigest(),
   (datetime.datetime.utcnow() + datetime.timedelta(days=30)).isoformat() + 'Z', now, now))
db.commit()
print('inserted discord account + session; token =', raw)
PYEOF
DC_TOKEN="at_$(printf 'e2e%.0s' {1..16})"

DC_LOGIN=$(curl -s -o /tmp/authfix-dclogin.json -w '%{http_code}' -X POST "$B/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"discorduser","password":"anypassword99"}')
DC_LOGIN_CODE=$(jqpy "['code']" < /tmp/authfix-dclogin.json)
[ "$DC_LOGIN" = "401" ] && [ "$DC_LOGIN_CODE" = "DISCORD_ONLY" ] \
  && ok "password login on Discord account -> 401 DISCORD_ONLY" || bad "discord login: HTTP $DC_LOGIN code $DC_LOGIN_CODE"

DC_USER=$(curl -s -o /tmp/authfix-dcuser.json -w '%{http_code}' -X POST "$B/api/auth/register" -H 'content-type: application/json' \
  -d '{"email":"newmail@example.com","password":"somepass99x","username":"discorduser","displayName":"X"}')
DC_USER_CODE=$(jqpy "['code']" < /tmp/authfix-dcuser.json)
[ "$DC_USER" = "409" ] && [ "$DC_USER_CODE" = "DISCORD_ONLY" ] \
  && ok "register with Discord username -> 409 DISCORD_ONLY" || bad "register discord username: HTTP $DC_USER code $DC_USER_CODE"

DC_EMAIL=$(curl -s -o /tmp/authfix-dcemail.json -w '%{http_code}' -X POST "$B/api/auth/register" -H 'content-type: application/json' \
  -d '{"email":"discord.user@example.com","password":"somepass99x","username":"othername","displayName":"X"}')
DC_EMAIL_CODE=$(jqpy "['code']" < /tmp/authfix-dcemail.json)
[ "$DC_EMAIL" = "409" ] && [ "$DC_EMAIL_CODE" = "DISCORD_ONLY" ] \
  && ok "register with Discord email -> 409 DISCORD_ONLY" || bad "register discord email: HTTP $DC_EMAIL code $DC_EMAIL_CODE"

ME_HP=$(curl -s "$B/api/auth/me" -H "authorization: Bearer $DC_TOKEN" | jqpy "['hasPassword']")
[ "$ME_HP" = "False" ] && ok "me: Discord account hasPassword=false" || bad "me hasPassword=$ME_HP"

echo "=== 9/10. add password on the Discord account, then password login ==="
ADDPW=$(curl -s -o /tmp/authfix-addpw.json -w '%{http_code}' -X POST "$B/api/auth/password" \
  -H "authorization: Bearer $DC_TOKEN" -H 'content-type: application/json' \
  -d '{"password":"newdiscordpw99"}')
[ "$ADDPW" = "200" ] && ok "add password -> 200" || bad "add password: HTTP $ADDPW $(cat /tmp/authfix-addpw.json)"

DC_LOGIN2=$(curl -s -o /tmp/authfix-dclogin2.json -w '%{http_code}' -X POST "$B/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"discord.user@example.com","password":"newdiscordpw99"}')
[ "$DC_LOGIN2" = "200" ] && ok "Discord account now logs in with password -> 200" || bad "discord pw login: HTTP $DC_LOGIN2 $(cat /tmp/authfix-dclogin2.json)"

echo "=== 11-13. change password on the tester account ==="
WRONGCUR=$(curl -s -o /tmp/authfix-wc.json -w '%{http_code}' -X POST "$B/api/auth/password" \
  -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"currentPassword":"notmypassword","password":"changedpw99x"}')
WCCODE=$(jqpy "['code']" < /tmp/authfix-wc.json)
[ "$WRONGCUR" = "403" ] && [ "$WCCODE" = "WRONG_PASSWORD" ] \
  && ok "wrong current password -> 403 WRONG_PASSWORD" || bad "wrong current: HTTP $WRONGCUR code $WCCODE"

WEAK=$(curl -s -o /tmp/authfix-weak.json -w '%{http_code}' -X POST "$B/api/auth/password" \
  -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"currentPassword":"hunter2hunter2","password":"short"}')
[ "$WEAK" = "400" ] && ok "weak new password -> 400" || bad "weak password: HTTP $WEAK"

CHANGED=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/auth/password" \
  -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"currentPassword":"hunter2hunter2","password":"changedpw99x"}')
RELOGIN=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"tester@example.com","password":"changedpw99x"}')
[ "$CHANGED" = "200" ] && [ "$RELOGIN" = "200" ] \
  && ok "change password -> 200 + relogin with new password -> 200" || bad "change: HTTP $CHANGED, relogin: HTTP $RELOGIN"

echo "=== 14. PATCH profile with a taken username (was a 500) ==="
PROF=$(curl -s -o /tmp/authfix-prof.json -w '%{http_code}' -X PATCH "$B/api/auth/profile" \
  -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"username":"discorduser"}')
PROFCODE=$(jqpy "['code']" < /tmp/authfix-prof.json)
[ "$PROF" = "409" ] && [ "$PROFCODE" = "USERNAME_TAKEN" ] \
  && ok "taken username via profile -> 409 USERNAME_TAKEN" || bad "profile taken: HTTP $PROF code $PROFCODE"

kill $SRV_PID 2>/dev/null
echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "ALL GREEN" || exit 1
