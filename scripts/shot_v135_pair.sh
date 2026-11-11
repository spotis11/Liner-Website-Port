#!/bin/bash
# canonical pair: same track (Rick Astley, has lyrics) with the pill ON vs OFF
AB="agent-browser"
APP="http://127.0.0.1:3000"
OUT=/tmp/render
strip() { sed -e 's/\\"/"/g' <<< "$1" | sed -e 's/^"//' -e 's/"$//'; }

$AB open "$APP/?e2e=v135pair" 2>&1 | tail -1
$AB wait --load networkidle --timeout 25000 2>&1 | tail -1
sleep 2
$AB eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(el => (el.textContent||'').includes('Continue as guest')); if (b) { b.click(); return 'guest'; } return 'no-guest'; })()" 2>/dev/null
$AB wait --load networkidle --timeout 25000 2>&1 | tail -1
sleep 3
$AB eval "(() => { const go = Array.from(document.querySelectorAll('button')).find(el => /let.?s go/i.test(el.textContent||'')); if (go) { go.click(); return 'go'; } return 'no-onboarding'; })()" 2>/dev/null
sleep 4

$AB eval "(() => { const btns = Array.from(document.querySelectorAll('button[aria-pressed]')); const sb = btns.find(b => b.className.includes('group')); if (!sb) return 'no-search-btn'; sb.click(); return 'toggled'; })()" 2>/dev/null
sleep 1.5
$AB eval "(() => { const inp = Array.from(document.querySelectorAll('input')).find(i => (i.offsetWidth || i.offsetHeight) && (i.type === 'text' || !i.type)); if (!inp) return 'noinput'; inp.focus(); return 'focused'; })()" 2>/dev/null
$AB keyboard type "Never Gonna Give You Up" 2>&1 | tail -1
sleep 6
$AB eval "(() => { const heads = Array.from(document.querySelectorAll('h3')); const t = heads.find(h => /never gonna/i.test(h.textContent||'') && /rick astley/i.test((h.closest('[role=button], button') || {}).textContent || '')); const btn = t ? t.closest('[role=button], button') : null; if (!btn) return 'noresult'; btn.click(); return 'clicked'; })()" 2>/dev/null
sleep 12
$AB eval "(() => { const b = document.querySelector('[aria-label=\"Open player\"]'); if (!b) return 'nobtn'; b.click(); return 'opened'; })()" 2>/dev/null
sleep 5
echo "state A (pill on):"
$AB eval "(() => { const pill = document.querySelector('button[aria-label=\"Lyrics\"]'); if (pill && pill.getAttribute('aria-pressed') !== 'true') pill.click(); return 'on'; })()" 2>/dev/null
sleep 4
$AB screenshot "$OUT/v135-pairA-on.png" 2>&1 | tail -1

echo "state B (pill off):"
$AB eval "(() => { document.querySelector('button[aria-label=\"Lyrics\"]').click(); return 'off'; })()" 2>/dev/null
sleep 4
$AB screenshot "$OUT/v135-pairB-off.png" 2>&1 | tail -1
ls -la "$OUT"/v135-pair*.png
