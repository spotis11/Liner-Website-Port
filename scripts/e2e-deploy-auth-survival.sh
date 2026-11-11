#!/bin/bash
# Definitive E2E: does a real website deploy log a signed-in user out?
# 1. guest login in a real browser  2. run deploy.sh (full rebuild+restart)
# 3. reload + fresh reopen -> check auth survives.
AB="agent-browser"
APP="http://127.0.0.1:3000"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
step() { echo; echo "=== $1 ==="; }
strip() { sed -e 's/\\"/"/g' <<< "$1" | sed -e 's/^"//' -e 's/"$//'; }

$AB close --all 2>/dev/null | tail -1
$AB set viewport 1440 900 2>&1 | tail -1

step "1. guest login"
$AB open "$APP/?e2e=deployauth" 2>&1 | tail -1
$AB wait --load networkidle --timeout 25000 2>&1 | tail -1
sleep 2
$AB eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(el => (el.textContent||'').includes('Continue as guest')); if (!b) return 'NOBTN'; b.click(); return 'clicked'; })()" 2>/dev/null
$AB wait --load networkidle --timeout 25000 2>&1 | tail -1
sleep 3
$AB eval "(() => { const go = Array.from(document.querySelectorAll('button')).find(el => /let.?s go/i.test(el.textContent||'')); if (go) { go.click(); return 'go'; } return 'no-onboarding'; })()" 2>/dev/null
sleep 4
USER1=$(strip "$($AB eval "(() => { const s = localStorage.getItem('liner_auth_session'); if (!s) return 'NOSESSION'; const j = JSON.parse(s); return 'signed-in:' + (j.user?.username || '?') + ',rt=' + (j.refreshToken ? 'yes' : 'no'); })()" 2>/dev/null)")
echo "  $USER1"
[[ "$USER1" == signed-in:* ]] && ok "guest signed in before deploy" || bad "not signed in ($USER1)"

step "2. run a REAL deploy (rebuild + rsync + next build + server restart)"
cd /home/z/my-project
bash scripts/deploy.sh > /tmp/deploy-auth-test.log 2>&1
grep -q "DEPLOY DONE" /tmp/deploy-auth-test.log && ok "deploy completed" || { bad "deploy failed"; tail -5 /tmp/deploy-auth-test.log; }
curl -s -o /dev/null -w "  server: HTTP %{http_code}\n" "$APP"

step "3. reload the SAME tab (user keeps the site open across the update)"
$AB open "$APP/" 2>&1 | tail -1
$AB wait --load networkidle --timeout 30000 2>&1 | tail -1
sleep 5
AFTER=$(strip "$($AB eval "(() => { const s = localStorage.getItem('liner_auth_session'); const loginPage = document.body.innerText.includes('Continue as guest'); const avatar = !!document.querySelector('[data-testid*=profile], [aria-label*=ccount], [aria-label*=rofile]'); return JSON.stringify({ session: !!s, loginPage, avatar }); })()" 2>/dev/null)")
echo "  $AFTER"
[[ "$AFTER" == *'"session":true'* && "$AFTER" == *'"loginPage":false'* ]] && ok "session survived deploy + reload (no login wall)" || bad "LOGGED OUT by deploy: $AFTER"

step "4. fully close and reopen the browser (worst case: user returns later)"
# NOTE: agent-browser starts every launch with a FRESH profile (proven by the
# canary test), so a session "loss" here is a tool artifact, not the app. Only
# assert when a canary survives the restart (i.e. the tool persisted storage).
$AB eval "localStorage.setItem('deploy_auth_canary','x')" >/dev/null 2>&1
$AB close --all 2>/dev/null | tail -1
$AB open "$APP/" 2>&1 | tail -1
$AB wait --load networkidle --timeout 30000 2>&1 | tail -1
sleep 5
CANARY=$(strip "$($AB eval "localStorage.getItem('deploy_auth_canary')" 2>/dev/null)")
REOPEN=$(strip "$($AB eval "(() => { const s = localStorage.getItem('liner_auth_session'); const loginPage = document.body.innerText.includes('Continue as guest'); return JSON.stringify({ session: !!s, loginPage }); })()" 2>/dev/null)")
echo "  canary=$CANARY $REOPEN"
if [ "$CANARY" != "x" ]; then
  echo "  SKIP: browser tool did not persist storage across restart (canary gone)"
else
  [[ "$REOPEN" == *'"session":true'* && "$REOPEN" == *'"loginPage":false'* ]] && ok "session survived close+reopen after deploy" || bad "LOGGED OUT on reopen: $REOPEN"
fi

echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
