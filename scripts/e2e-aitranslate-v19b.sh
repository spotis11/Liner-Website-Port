#!/bin/bash
# E2E v2: fresh browser (no stale service worker), enable toggle first, then test.
AB="agent-browser"
OUT=/home/z/my-project/download
mkdir -p "$OUT"

step() { echo; echo "=== $1 ==="; }

$AB close 2>/dev/null | tail -1

step "1. fresh session, mock auth, seed, load"
$AB network route "**/v1/me" --body '{"id":"e2e-user","email":"e2e@test.local","username":"e2etester","displayName":"E2E Tester"}' 2>&1 | tail -1
$AB network route "**/auth/refresh" --body '{"accessToken":"e2e-fake-token","accessTokenExpiresAt":1799999999000}' 2>&1 | tail -1
$AB open "http://127.0.0.1:3000/?v=19" 2>&1 | tail -1
$AB wait --load networkidle --timeout 20000 2>&1 | tail -1
$AB eval "localStorage.setItem('liner_auth_session', JSON.stringify({accessToken:'e2e-fake-token',refreshToken:'e2e-fake-refresh',accessTokenExpiresAt:Date.now()+3600e3,expiresAt:Date.now()+3600e3,user:{id:'e2e-user',email:'e2e@test.local',username:'e2etester',displayName:'E2E Tester'}})); 'seeded'"
$AB reload 2>&1 | tail -1
$AB wait --load networkidle --timeout 20000 2>&1 | tail -1
$AB eval "JSON.stringify({sw: navigator.serviceWorker ? navigator.serviceWorker.controller : null, entry: Array.from(document.scripts).map(s=>s.src).find(s=>s.includes('index-'))})"

step "2. settings → AI Translate tab"
$AB eval "location.hash = '#/settings'; 'nav'"
$AB wait 1200 2>&1 | tail -1
$AB eval "(() => { const tab = Array.from(document.querySelectorAll('[role=tab], button')).find(b => (b.textContent||'').includes('AI Translate')); if (!tab) return 'NO_AITAB'; tab.click(); return 'clicked'; })()"
$AB wait 800 2>&1 | tail -1

step "3. provider grid — 7 cards with Liner AI first?"
$AB eval "(() => { const cards = Array.from(document.querySelectorAll('button')).filter(b => b.querySelector('.liner-brand-logo')); const labels = cards.map(c => c.textContent.trim().split('\n')[0]); return JSON.stringify({count: cards.length, cards: labels}); })()"

step "4. enable the feature toggle (config + test button appear)"
$AB eval "(() => { const sw = document.querySelector('[role=switch]'); if (!sw) return 'NO_SWITCH'; const before = sw.getAttribute('aria-checked'); sw.click(); return 'was:' + before; })()"
$AB wait 500 2>&1 | tail -1
$AB eval "(() => { const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').trim().startsWith('Test connection')); return btn ? 'TEST_BTN_OK' : 'NO_TEST_BTN'; })()"

step "5. live test — Liner AI (default provider)"
$AB eval "(() => { const sel = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').includes('Liner AI')); if (sel) sel.click(); return 'liner selected'; })()"
$AB wait 300 2>&1 | tail -1
$AB eval "(() => { const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').trim().startsWith('Test connection')); btn.click(); return 'testing'; })()"
$AB wait 9000 2>&1 | tail -1
$AB eval "(() => { const t = document.body.innerText; const m = t.match(/Hello world[^\n]*/); return JSON.stringify({ok: t.includes('Translation works'), fail: t.includes('Test failed'), sample: m ? m[0].slice(0,140) : null}); })()"

step "6. switch to Google Translate, test (browser-direct chain)"
$AB eval "(() => { const card = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').includes('Google Translate')); if (!card) return 'NO_CARD'; card.click(); return 'selected'; })()"
$AB wait 400 2>&1 | tail -1
$AB eval "(() => { const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').trim().startsWith('Test connection')); btn.click(); return 'testing'; })()"
$AB wait 12000 2>&1 | tail -1
$AB eval "(() => { const t = document.body.innerText; const m = t.match(/Hello world[^\n]*/); return JSON.stringify({ok: t.includes('Translation works'), fail: t.includes('Test failed'), sample: m ? m[0].slice(0,140) : null}); })()"

step "7. screenshot"
$AB screenshot "$OUT/aitranslate_v19_settings.png" 2>&1 | tail -1
