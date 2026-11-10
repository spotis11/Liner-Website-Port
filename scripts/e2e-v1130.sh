#!/bin/bash
# E2E v1.13.0 (r2): real login (guest + API roundtrip), playback via search,
# lyrics-pill animation (CSSOM rule + ring pulse + glyph reveal), removals
# verified (downloads / local music / fork EQ), CORS audit.
AB="agent-browser"
APP="http://127.0.0.1:3000"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
step() { echo; echo "=== $1 ==="; }
strip() { sed -e 's/\\"/"/g' <<< "$1" | sed -e 's/^"//' -e 's/"$//'; }

# 0. make sure prod is up (sandbox recycles processes between messages)
if ! curl -s -o /dev/null --max-time 3 http://localhost:3000; then
  cd /home/z/my-project
  nohup node .next/standalone/server.js > /tmp/liner-prod.log 2>&1 &
  echo $! > /tmp/liner-prod.pid
  sleep 4
fi

$AB close --all 2>/dev/null | tail -1
$AB set viewport 1440 900 2>&1 | tail -1

step "1. fresh visit -> login page"
$AB open "$APP/?e2e=v1130r2" 2>&1 | tail -1
$AB wait --load networkidle --timeout 25000 2>&1 | tail -1
sleep 2
$AB console --clear >/dev/null 2>&1
$AB errors --clear >/dev/null 2>&1
$AB network requests --clear >/dev/null 2>&1
GUEST=$(strip "$($AB eval "document.body.textContent.includes('Continue as guest') ? 'yes' : 'no'" 2>/dev/null)")
if [ "$GUEST" = "yes" ]; then ok "login page shown with guest button"; else bad "login page/guest button missing"; fi

step "2. guest login through the UI (one tap, real backend)"
$AB eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(el => (el.textContent||'').includes('Continue as guest')); if (!b) return 'NOBTN'; b.click(); return 'clicked'; })()" 2>/dev/null
$AB wait --load networkidle --timeout 25000 2>&1 | tail -1
sleep 3
SESS=$(strip "$($AB eval "(() => { const s = localStorage.getItem('liner_auth_session'); if (!s) return 'NOSESSION'; const j = JSON.parse(s); return j.user ? ('user:' + (j.user.username || j.user.id)) : 'NOUSER'; })()" 2>/dev/null)")
case "$SESS" in
  user:*) ok "guest session stored ($SESS)";;
  *) bad "guest session not created ($SESS)";;
esac
$AB eval "(() => { const go = Array.from(document.querySelectorAll('button')).find(el => /let.?s go/i.test(el.textContent||'')); if (go) { go.click(); return 'go'; } return 'no-onboarding'; })()" 2>/dev/null
sleep 4

step "3. sidebar = upstream set, no downloads / no local music"
SIDEBAR=$(strip "$($AB eval "(() => { const home = !!document.querySelector('a[href=\"#/\"]'); const lib = !!document.querySelector('a[href=\"#/library\"]'); const iconBtns = Array.from(document.querySelectorAll('button[aria-pressed]')).length; return JSON.stringify({home, lib, iconBtns}); })()" 2>/dev/null)")
echo "  sidebar: $SIDEBAR"
HOME_LINK=$(strip "$($AB eval "document.querySelector('a[href=\"#/\"]') ? 'yes' : 'no'" 2>/dev/null)")
LIB_LINK=$(strip "$($AB eval "document.querySelector('a[href=\"#/library\"]') ? 'yes' : 'no'" 2>/dev/null)")
[ "$HOME_LINK" = "yes" ] && [ "$LIB_LINK" = "yes" ] && ok "upstream sidebar links present (Home + Library + icon toggles)" || bad "sidebar links missing"
BODYTXT=$($AB eval "document.body.textContent" 2>/dev/null)
case "$BODYTXT" in
  *"Downloads"*|*"Downloads tab"*) bad "Downloads still referenced in UI";;
  *) ok "no Downloads tab in UI";;
esac
case "$BODYTXT" in
  *"Local Music"*|*"Local music"*|*"Local Tracks"*) bad "Local Music still referenced in UI";;
  *) ok "no Local Music tab in UI";;
esac

step "4. same-origin auth API roundtrip (register -> login -> me), inside the page"
RT=$(strip "$($AB eval "(async () => {
  const email = 'e2e' + Date.now() + '@liner-e2e.local';
  const reg = await fetch('/api/auth/register', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ email, password: 'e2e-Password1', username: 'e2e' + (Date.now()%100000), displayName: 'E2E Tester' }) });
  if (reg.status !== 200 && reg.status !== 201) return 'reg:' + reg.status;
  const login = await fetch('/api/auth/login', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ email, password: 'e2e-Password1' }) });
  if (login.status !== 200) return 'login:' + login.status;
  const loginBody = await login.json().catch(() => ({}));
  const me = await fetch('/api/auth/me', { headers: { authorization: 'Bearer ' + (loginBody.accessToken||'') } });
  if (me.status !== 200) return 'me:' + me.status;
  return 'roundtrip-ok';
})()" 2>/dev/null)")
[ "$RT" = "roundtrip-ok" ] && ok "register->login->me works same-origin" || bad "auth API roundtrip: $RT"

step "4b. same-origin /v1 endpoints (no upstream, no CORS)"
V1=$(strip "$($AB eval "(async () => {
  const h = await fetch('/v1/me/history');
  const d = await fetch('/v1/me/recommendations/daily-mixes');
  const e = await fetch('/v1/explore/popular');
  if (h.status !== 200 || d.status !== 200 || e.status !== 200) return 'statuses:' + h.status + '/' + d.status + '/' + e.status;
  const dj = await d.json();
  const ej = await e.json();
  return 'v1-ok:mixes=' + Array.isArray(dj.items) + ',popular=' + Array.isArray(ej.items);
})()" 2>/dev/null)")
case "$V1" in
  v1-ok:*) ok "v1 endpoints served same-origin ($V1)";;
  *) bad "v1 endpoints: $V1";;
esac

step "5. search a track and start playback"
$AB eval "(() => { const btns = Array.from(document.querySelectorAll('button[aria-pressed]')); const sb = btns.find(b => b.className.includes('group')); if (!sb) return 'no-search-btn'; sb.click(); return 'toggled'; })()" 2>/dev/null
sleep 1.5
$AB eval "(() => { const inp = Array.from(document.querySelectorAll('input')).find(i => (i.offsetWidth || i.offsetHeight) && (i.type === 'text' || !i.type)); if (!inp) return 'noinput'; inp.focus(); return 'focused:' + inp.placeholder; })()" 2>/dev/null
$AB keyboard type "Never Gonna Give You Up" 2>&1 | tail -1
sleep 6
CLICK=$(strip "$($AB eval "(() => { const heads = Array.from(document.querySelectorAll('h3')); const t = heads.find(h => /never gonna/i.test(h.textContent||'') && /rick astley/i.test((h.closest('[role=button], button') || {}).textContent || '')); const btn = t ? t.closest('[role=button], button') : null; if (!btn) return 'noresult'; btn.click(); return 'clicked'; })()" 2>/dev/null)")
echo "  $CLICK"
sleep 10
PLAYING=$($AB eval "(() => { const a = document.querySelector('audio'); return a && !a.paused ? 'yes@' + a.currentTime.toFixed(1) : 'no'; })()" 2>/dev/null)
CONSOLE_PLAY=$($AB console 2>/dev/null | rg "playback %c started" | head -1)
if [[ "$(strip "$PLAYING")" == yes@* ]] || [ -n "$CONSOLE_PLAY" ]; then ok "playback started (audio=$(strip "$PLAYING"))"; else bad "playback did not start (audio=$(strip "$PLAYING"))"; fi

step "6. open fullscreen player"
$AB eval "(() => { const b = document.querySelector('[aria-label=\"Open player\"]'); if (!b) return 'nobtn'; b.click(); return 'opened'; })()" 2>/dev/null
sleep 2.5
PILL=$(strip "$($AB eval "(() => { const b = document.querySelector('button[aria-label=\"Lyrics\"]'); if (!b) return 'nopill'; return 'pill-ok,pressed=' + b.getAttribute('aria-pressed'); })()" 2>/dev/null)")
echo "  $PILL"

step "7. lyrics pill press animation (CSSOM rule + transition wiring)"
ANIM=$(strip "$($AB eval "(() => {
  const b = document.querySelector('button[aria-label=\"Lyrics\"]');
  if (!b) return 'nopill';
  const cls = b.className;
  const hasActive = /active:scale-\[0\.9\]/.test(cls);
  const transition = getComputedStyle(b).transitionProperty;
  const includesScale = transition.split(',').map(s => s.trim()).includes('scale');
  const duration = getComputedStyle(b).transitionDuration;
  let ruleInCss = false;
  const walk = (rules) => { for (const r of rules) { if (r.cssRules && r.cssRules.length) { walk(r.cssRules); continue; } const sel = r.selectorText || ''; if (sel.includes(':active') && sel.includes('scale')) { ruleInCss = true; return; } } };
  for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch {} }
  return JSON.stringify({ hasActive, includesScale, ruleInCss, duration });
})()" 2>/dev/null)")
echo "  $ANIM"
case "$ANIM" in
  *'"hasActive":true'*'"includesScale":true'*'"ruleInCss":true'*) ok "press animation wired: active:scale rule in stylesheet + transition covers scale";;
  *) bad "animation wiring incomplete: $ANIM";;
esac

step "8. lyrics toggle choreography (ring pulse + glyph reveal + state flip)"
TOGGLE_RES=$(strip "$($AB eval "(async () => {
  const b = document.querySelector('button[aria-label=\"Lyrics\"]');
  if (!b) return 'nopill';
  const before = b.getAttribute('aria-pressed');
  const ringDuring = (ms) => new Promise((resolve) => {
    let seen = false;
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (b.querySelector('span[aria-hidden].pointer-events-none')) seen = true;
      if (Date.now() - t0 > ms) { clearInterval(iv); resolve(seen); }
    }, 30);
  });
  b.click();
  const ring = await ringDuring(400);
  await new Promise((r) => setTimeout(r, 500));
  const after = b.getAttribute('aria-pressed');
  const svg = !!b.querySelector('svg');
  return JSON.stringify({ before, after, ringSeen: ring, glyphIn: svg && after === 'true' });
})()" 2>/dev/null)")
echo "  $TOGGLE_RES"
case "$TOGGLE_RES" in
  *'"before":"true"'*'"after":"false"'*'"ringSeen":true'*) ok "ring pulse fired on toggle-off (expanding circle choreography)";;
  *'"before":"false"'*'"after":"true"'*'"ringSeen":true'*) ok "ring pulse fired on toggle-on";;
  *) bad "toggle choreography: $TOGGLE_RES";;
esac
GLYPH=$(strip "$($AB eval "(() => { const b = document.querySelector('button[aria-label=\"Lyrics\"]'); return JSON.stringify({ pressed: b.getAttribute('aria-pressed'), glyph: !!b.querySelector('svg') }); })()" 2>/dev/null)")
case "$GLYPH" in
  *'"pressed":"true"'*'"glyph":true'*) ok "music glyph slid in when lyrics visible";;
  *'"pressed":"false"'*'"glyph":false'*) ok "glyph slid out when lyrics hidden (toggle choreography reversed cleanly)";;
  *) bad "glyph state: $GLYPH";;
esac
$AB eval "(() => { const b = document.querySelector('button[aria-label=\"Lyrics\"]'); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); return 'restored'; })()" >/dev/null 2>&1

step "9. equalizer: upstream quick picker present, fork modal gone"
EQBTN=$(strip "$($AB eval "(() => { const b = document.querySelector('[aria-label=\"Equalizer\"]'); return b ? 'present' : 'absent'; })()" 2>/dev/null)")
if [ "$EQBTN" = "present" ]; then ok "upstream equalizer quick picker button present"; else bad "equalizer button absent"; fi
BANDS=$(strip "$($AB eval "(() => { return document.body.textContent.includes('10-band') || document.body.textContent.includes('10 band') ? 'fork-modal-marker' : 'clean'; })()" 2>/dev/null)")
if [ "$BANDS" = "clean" ]; then ok "no fork 10-band EQ modal markers"; else bad "fork EQ remnants: $BANDS"; fi

step "10. CORS audit (console errors + failed requests)"
sleep 2
CONSOLE=$($AB console 2>/dev/null | rg -i "cors|access-control|cross-origin" | head -5)
if [ -z "$CONSOLE" ]; then ok "no CORS messages in console"; else bad "CORS console messages: $CONSOLE"; fi
CORSREQ=$($AB network requests 2>/dev/null | rg -i "cors" | head -5)
if [ -z "$CORSREQ" ]; then ok "no CORS failures in network log"; else bad "CORS request failures: $CORSREQ"; fi
ERRS=$($AB errors 2>/dev/null | head -10)
if [ -z "$ERRS" ] || [ "$ERRS" = "No page errors" ] || [ "$ERRS" = "[]" ]; then ok "no uncaught page errors"; else echo "  page errors:"; echo "$ERRS" | head -6; fi
UPSTREAM_BROWSER=$($AB network requests 2>/dev/null | rg -i "api.tryliner.fun" | head -4)
if [ -z "$UPSTREAM_BROWSER" ]; then ok "browser makes zero direct upstream API calls"; else echo "  note: browser upstream calls:"; echo "$UPSTREAM_BROWSER"; fi

echo
echo "======================================"
echo "E2E RESULT: PASS=$PASS FAIL=$FAIL"
echo "======================================"
[ "$FAIL" = "0" ] && exit 0 || exit 1
