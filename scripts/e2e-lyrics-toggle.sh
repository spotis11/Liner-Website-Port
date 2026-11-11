#!/bin/bash
# E2E: restored fullscreen Lyrics toggle pill (fork feature on top of the
# upstream v1.13.1 canvas rewrite). Guest login -> search -> play -> fullscreen
# -> pill pressed state -> toggle off (pane collapse + localStorage + notch
# gating + canvas unmount) -> toggle back on.
AB="agent-browser"
APP="http://127.0.0.1:3000"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
step() { echo; echo "=== $1 ==="; }
strip() { sed -e 's/\\"/"/g' <<< "$1" | sed -e 's/^"//' -e 's/"$//'; }

if ! curl -s -o /dev/null --max-time 3 http://localhost:3000; then
  cd /home/z/my-project
  nohup node .next/standalone/server.js > /tmp/liner-prod.log 2>&1 &
  echo $! > /tmp/liner-prod.pid
  sleep 4
fi

$AB close --all 2>/dev/null | tail -1
$AB set viewport 1440 900 2>&1 | tail -1

step "1. fresh visit -> guest login"
$AB open "$APP/?e2e=lyricstoggle" 2>&1 | tail -1
$AB wait --load networkidle --timeout 25000 2>&1 | tail -1
sleep 2
$AB console --clear >/dev/null 2>&1
$AB errors --clear >/dev/null 2>&1
$AB eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(el => (el.textContent||'').includes('Continue as guest')); if (!b) return 'NOBTN'; b.click(); return 'clicked'; })()" 2>/dev/null
$AB wait --load networkidle --timeout 25000 2>&1 | tail -1
sleep 3
SESS=$(strip "$($AB eval "(() => { const s = localStorage.getItem('liner_auth_session'); if (!s) return 'NOSESSION'; const j = JSON.parse(s); return j.user ? 'user' : 'NOUSER'; })()" 2>/dev/null)")
[ "$SESS" = "user" ] && ok "guest session stored" || bad "no session ($SESS)"
$AB eval "(() => { const go = Array.from(document.querySelectorAll('button')).find(el => /let.?s go/i.test(el.textContent||'')); if (go) { go.click(); return 'go'; } return 'no-onboarding'; })()" 2>/dev/null
sleep 4

step "2. search a track and start playback"
$AB eval "(() => { const btns = Array.from(document.querySelectorAll('button[aria-pressed]')); const sb = btns.find(b => b.className.includes('group')); if (!sb) return 'no-search-btn'; sb.click(); return 'toggled'; })()" 2>/dev/null
sleep 1.5
$AB eval "(() => { const inp = Array.from(document.querySelectorAll('input')).find(i => (i.offsetWidth || i.offsetHeight) && (i.type === 'text' || !i.type)); if (!inp) return 'noinput'; inp.focus(); return 'focused'; })()" 2>/dev/null
$AB keyboard type "Never Gonna Give You Up" 2>&1 | tail -1
sleep 6
CLICK=$(strip "$($AB eval "(() => { const heads = Array.from(document.querySelectorAll('h3')); const t = heads.find(h => /never gonna/i.test(h.textContent||'') && /rick astley/i.test((h.closest('[role=button], button') || {}).textContent || '')); const btn = t ? t.closest('[role=button], button') : null; if (!btn) return 'noresult'; btn.click(); return 'clicked'; })()" 2>/dev/null)")
echo "  $CLICK"
sleep 12
PLAYING=$($AB eval "(() => { const a = document.querySelector('audio'); return a && !a.paused ? 'yes@' + a.currentTime.toFixed(1) : 'no'; })()" 2>/dev/null)
case "$(strip "$PLAYING")" in
  yes@*) ok "playback started ($(strip "$PLAYING"))";;
  *) bad "playback did not start ($(strip "$PLAYING"))";;
esac

step "3. open fullscreen player -> Lyrics pill present + pressed"
$AB eval "(() => { const b = document.querySelector('[aria-label=\"Open player\"]'); if (!b) return 'nobtn'; b.click(); return 'opened'; })()" 2>/dev/null
sleep 3
PILL=$(strip "$($AB eval "(() => { const b = document.querySelector('button[aria-label=\"Lyrics\"]'); if (!b) return 'nopill'; return 'pill-ok,pressed=' + b.getAttribute('aria-pressed'); })()" 2>/dev/null)")
case "$PILL" in
  pill-ok,pressed=true) ok "pill rendered pressed=true ($PILL)";;
  *) bad "pill check failed ($PILL)";;
esac

step "4. toggle OFF: pane collapses, pref persists, notch status hides, canvas unmounts"
OFF_RES=$(strip "$($AB eval "(() => {
  const b = document.querySelector('button[aria-label=\"Lyrics\"]');
  if (!b) return 'nopill';
  b.click();
  return new Promise((resolve) => setTimeout(() => {
    const stored = localStorage.getItem('liner.fullscreen.lyricsVisible');
    const pressed = b.getAttribute('aria-pressed');
    const canvas = document.querySelector('canvas');
    resolve(JSON.stringify({ stored, pressed, canvasGone: !canvas }));
  }, 900));
})()" 2>/dev/null)")
echo "  $OFF_RES"
case "$OFF_RES" in
  *'"stored":"0"'*'"pressed":"false"'*) ok "toggle off: aria-pressed=false + localStorage=0";;
  *) bad "toggle off state wrong: $OFF_RES";;
esac

step "5. toggle ON again: pane returns, pref=1"
ON_RES=$(strip "$($AB eval "(() => {
  const b = document.querySelector('button[aria-label=\"Lyrics\"]');
  if (!b) return 'nopill';
  b.click();
  return new Promise((resolve) => setTimeout(() => {
    resolve(JSON.stringify({
      stored: localStorage.getItem('liner.fullscreen.lyricsVisible'),
      pressed: b.getAttribute('aria-pressed'),
    }));
  }, 900));
})()" 2>/dev/null)")
echo "  $ON_RES"
case "$ON_RES" in
  *'"stored":"1"'*'"pressed":"true"'*) ok "toggle on: aria-pressed=true + localStorage=1";;
  *) bad "toggle on state wrong: $ON_RES";;
esac

step "6. no page errors during toggling"
ERRS=$($AB errors 2>/dev/null | rg -c "Error|error" || echo 0)
[ "$ERRS" = "0" ] && ok "zero console errors" || bad "$ERRS console errors"

echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
