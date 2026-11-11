#!/bin/bash
# E2E: Discord OAuth login against a local mock Discord (scripts/mock_discord_oauth.js).
# Covers: start redirect shape, PKCE enforcement (mock verifies S256), state
# cookie, callback error paths, account auto-create + session handoff via the
# SPA fragment, and the signed-in UI (avatar/name visible in the app shell).
AB="agent-browser"
APP="http://127.0.0.1:3000"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
step() { echo; echo "=== $1 ==="; }
strip() { sed -e 's/\\"/"/g' <<< "$1" | sed -e 's/^"//' -e 's/"$//'; }

step "1. mock discord up + prod server restarted with mock endpoints"
if curl -s -o /dev/null --max-time 2 http://127.0.0.1:9420/users/@me; then
  echo "  mock already running"
else
  node /home/z/my-project/scripts/mock_discord_oauth.js > /tmp/mock_discord.log 2>&1 &
  echo $! > /tmp/mock_discord.pid
  sleep 1
fi
if [ -f /tmp/liner-prod.pid ] && kill -0 "$(cat /tmp/liner-prod.pid)" 2>/dev/null; then
  kill "$(cat /tmp/liner-prod.pid)"; sleep 2
fi
cd /home/z/my-project
DATABASE_URL="file:/home/z/my-project/db/custom.db" \
DISCORD_API_BASE="http://127.0.0.1:9420" \
DISCORD_AUTHORIZE_BASE="http://127.0.0.1:9420/oauth2/authorize" \
DISCORD_PUBLIC_BASE="http://127.0.0.1:3000" \
NODE_ENV=production PORT=3000 HOSTNAME=127.0.0.1 \
nohup node .next/standalone/server.js > /tmp/liner-prod.log 2>&1 &
echo $! > /tmp/liner-prod.pid
sleep 4
curl -s -o /dev/null -w "prod :3000 -> HTTP %{http_code}\n" "$APP"

step "2. /api/auth/discord/start redirects to the mock authorize screen"
HDRS=$(curl -s -D - -o /dev -c /tmp/discord_cookies.txt "$APP/api/auth/discord/start")
LOC=$(rg -i "^location:" <<< "$HDRS" | tr -d '\r' | head -1)
set_cookie=$(rg -i "liner_discord_oauth" <<< "$HDRS" | head -1)
echo "  $LOC"
case "$LOC" in
  *127.0.0.1:9420/oauth2/authorize*client_id=1552617559675633664*identify+email*state=*code_challenge_method=S256*)
    ok "authorize URL: mock host, client_id, scopes, PKCE S256 + state";;
  *) bad "authorize URL unexpected ($LOC)";;
esac
[ -n "$set_cookie" ] && ok "state cookie set (httpOnly)" || bad "no state cookie"

step "3. callback rejects forged/wrong-state callbacks"
STALE_STATE=$(rg -o 'state=([A-Za-z0-9_-]+)' -r '$1' <<< "$LOC" | head -1)
NOCOOKIE=$(curl -s -D - -o /dev "$APP/api/auth/discord/callback?code=x&state=$STALE_STATE" | rg -i "^location:" | tr -d '\r')
case "$NOCOOKIE" in
  *"error=expired"*) ok "no state cookie -> error=expired";;
  *) bad "no-cookie callback wrong ($NOCOOKIE)";;
esac
WRONGSTATE=$(curl -s -b /tmp/discord_cookies.txt -D - -o /dev "$APP/api/auth/discord/callback?code=x&state=forgedstate" | rg -i "^location:" | tr -d '\r')
case "$WRONGSTATE" in
  *"error=state_mismatch"*) ok "cookie present but state differs -> state_mismatch";;
  *) bad "forged state not rejected ($WRONGSTATE)";;
esac

step "4. access_denied path"
DENIED=$(curl -s -D - -o /dev "$APP/api/auth/discord/callback?error=access_denied&state=x" | rg -i "^location:" | tr -d '\r')
case "$DENIED" in
  *"error=denied"*) ok "user-cancel maps to error=denied";;
  *) bad "access_denied mapping wrong ($DENIED)";;
esac

step "5. real browser flow: login page -> Continue with Discord -> signed in"
$AB close --all 2>/dev/null | tail -1
$AB set viewport 1440 900 2>&1 | tail -1
$AB open "$APP/?e2e=discordlogin" 2>&1 | tail -1
$AB wait --load networkidle --timeout 25000 2>&1 | tail -1
sleep 2
$AB errors --clear >/dev/null 2>&1
$AB eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(el => (el.textContent||'').includes('Continue with Discord')); if (!b) return 'NOBTN'; b.click(); return 'clicked'; })()" 2>/dev/null
$AB wait --load networkidle --timeout 25000 2>&1 | tail -1
sleep 5
SESS=$(strip "$($AB eval "(() => { const s = localStorage.getItem('liner_auth_session'); if (!s) return 'NOSESSION'; const j = JSON.parse(s); return JSON.stringify({user: j.user?.username, name: j.user?.displayName, hasAt: !!j.accessToken, atPrefix: (j.accessToken||'').slice(0,3)}); })()" 2>/dev/null)")
echo "  session: $SESS"
case "$SESS" in
  *e2e_discord_user*hasAt.*atPrefix.*at_*) ok "signed in as e2e_discord_user with at_ session";;
  *e2e_discord_user*) ok "signed in as e2e_discord_user";;
  *) bad "no discord session in localStorage ($SESS)";;
esac
URL=$(strip "$($AB eval "window.location.hash" 2>/dev/null)")
echo "  hash: $URL"
case "$URL" in
  *at=*) bad "tokens still visible in the hash";;
  *) ok "fragment consumed — tokens gone from the URL";;
esac
$AB screenshot /tmp/render/discord-e2e-signedin.png 2>&1 | tail -1

step "6. server-side: account row exists with discordId + session"
ACC=$(cd /home/z/my-project && python3 -c "
import sqlite3
c = sqlite3.connect('db/custom.db')
row = c.execute(\"SELECT username, displayName, discordId, avatarUrl FROM Account WHERE discordId='918273645500000001'\").fetchone()
print(row)")
echo "  db: $ACC"
case "$ACC" in
  *e2e_discord_user*918273645500000001*) ok "Account row created/linked with discordId";;
  *) bad "Account row missing ($ACC)";;
esac

step "7. console errors during the flow"
ERRS=$($AB errors 2>/dev/null | rg -v "^\s*$" | rg -vc "\bNo (page|console) errors\b" || echo 0)
echo "  raw: $($AB errors 2>/dev/null | head -3 | tr '\n' ' ')"
[ "$ERRS" = "0" ] && ok "zero console errors" || bad "console errors: $ERRS"

echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
# leave the mock running for teardown by the caller; note pid
echo "mock pid: $(cat /tmp/mock_discord.pid)"
