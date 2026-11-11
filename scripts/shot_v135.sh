#!/bin/bash
# v1.13.5 visual check: fullscreen layout follows the Lyrics toggle.
#  state A: lyrics ON   -> vertical   (cover stacked above the controls)
#  state B: toggle OFF  -> horizontal (cover beside the controls, centered)
#  state C: no lyrics   -> horizontal (notch shows "No lyrics found")
AB="agent-browser"
APP="http://127.0.0.1:3000"
OUT=/tmp/render
mkdir -p "$OUT"
strip() { sed -e 's/\\"/"/g' <<< "$1" | sed -e 's/^"//' -e 's/"$//'; }

$AB close --all 2>/dev/null | tail -1
$AB set viewport 1440 900 2>&1 | tail -1

$AB open "$APP/?e2e=v135shots" 2>&1 | tail -1
$AB wait --load networkidle --timeout 25000 2>&1 | tail -1
sleep 2
$AB eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(el => (el.textContent||'').includes('Continue as guest')); if (b) { b.click(); return 'guest'; } return 'no-guest'; })()" 2>/dev/null
$AB wait --load networkidle --timeout 25000 2>&1 | tail -1
sleep 3
$AB eval "(() => { const go = Array.from(document.querySelectorAll('button')).find(el => /let.?s go/i.test(el.textContent||'')); if (go) { go.click(); return 'go'; } return 'no-onboarding'; })()" 2>/dev/null
sleep 4

play_track() { # $1 query, $2 title regex
  $AB eval "(() => { const btns = Array.from(document.querySelectorAll('button[aria-pressed]')); const sb = btns.find(b => b.className.includes('group')); if (!sb) return 'no-search-btn'; sb.click(); return 'toggled'; })()" 2>/dev/null
  sleep 1.5
  $AB eval "(() => { const inp = Array.from(document.querySelectorAll('input')).find(i => (i.offsetWidth || i.offsetHeight) && (i.type === 'text' || !i.type)); if (!inp) return 'noinput'; inp.focus(); return 'focused'; })()" 2>/dev/null
  $AB keyboard type "$1" 2>&1 | tail -1
  sleep 6
  $AB eval "(() => { const heads = Array.from(document.querySelectorAll('h3')); const t = heads.find(h => $2.test(h.textContent||'')); const btn = t ? t.closest('[role=button], button') : null; if (!btn) return 'noresult'; btn.click(); return 'clicked'; })()" 2>/dev/null
  sleep 12
}

open_fullscreen() {
  $AB eval "(() => { const b = document.querySelector('[aria-label=\"Open player\"]'); if (!b) return 'nobtn'; b.click(); return 'opened'; })()" 2>/dev/null
  sleep 3
}

echo "=== A: lyrics ON (Never Gonna Give You Up) ==="
play_track "Never Gonna Give You Up" "/never gonna/i"
open_fullscreen
$AB eval "(() => { const b = document.querySelector('button[aria-label=\"Lyrics\"]'); if (b && b.getAttribute('aria-pressed') !== 'true') { b.click(); return 'turned-on'; } return 'already-on'; })()" 2>/dev/null
sleep 4
$AB screenshot "$OUT/v135-a-on-vertical.png" 2>&1 | tail -1
$AB eval "(() => { const ui = document.querySelector('[data-layout]'); const pill = document.querySelector('button[aria-label=\"Lyrics\"]'); return JSON.stringify({layout: ui ? ui.getAttribute('data-layout') : 'no-marker', pressed: pill ? pill.getAttribute('aria-pressed') : 'nopill'}); })()" 2>/dev/null

echo "=== B: toggle OFF ==="
$AB eval "(() => { document.querySelector('button[aria-label=\"Lyrics\"]').click(); return 'toggled-off'; })()" 2>/dev/null
sleep 4
$AB screenshot "$OUT/v135-b-off-horizontal.png" 2>&1 | tail -1

echo "=== C: no lyrics found (Aphex Twin Rhubarb) ==="
$AB eval "(() => { const b = document.querySelector('[aria-label=\"Close player\"]') || document.querySelector('button[aria-label*lose]'); if (b) { b.click(); return 'closed'; } return 'no-close'; })()" 2>/dev/null
sleep 2
$AB eval "(() => { const b = document.querySelector('button[aria-label=\"Lyrics\"]'); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); return 'pill-reset-on'; })()" 2>/dev/null
play_track "Aphex Twin Rhubarb" "/rhubarb/i"
open_fullscreen
sleep 3
$AB screenshot "$OUT/v135-c-nolyrics-horizontal.png" 2>&1 | tail -1
$AB eval "(() => { const notch = document.body.innerText.match(/no lyrics found|instrumental/i); const ui = document.querySelector('[data-layout]'); return JSON.stringify({notch: notch ? notch[0] : 'none', layout: ui ? ui.getAttribute('data-layout') : 'no-marker'}); })()" 2>/dev/null

echo "shots:"; ls -la "$OUT"/v135-*.png
