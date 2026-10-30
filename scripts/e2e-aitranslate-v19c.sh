#!/bin/bash
# E2E v3: capture the real test-connection error + network log.
AB="agent-browser"
OUT=/home/z/my-project/download

step() { echo; echo "=== $1 ==="; }

$AB close 2>/dev/null | tail -1

step "1. fresh session + auth mock + seed"
$AB network route "**/v1/me" --body '{"id":"e2e-user","email":"e2e@test.local","username":"e2etester","displayName":"E2E Tester"}' 2>&1 | tail -1
$AB network route "**/auth/refresh" --body '{"accessToken":"e2e-fake-token","accessTokenExpiresAt":1799999999000}' 2>&1 | tail -1
$AB open "http://127.0.0.1:3000/?v=19c" 2>&1 | tail -1
$AB wait --load networkidle --timeout 20000 2>&1 | tail -1
$AB eval "localStorage.setItem('liner_auth_session', JSON.stringify({accessToken:'e2e-fake-token',refreshToken:'e2e-fake-refresh',accessTokenExpiresAt:Date.now()+3600e3,expiresAt:Date.now()+3600e3,user:{id:'e2e-user',email:'e2e@test.local',username:'e2etester',displayName:'E2E Tester'}})); 'seeded'"
$AB reload 2>&1 | tail -1
$AB wait --load networkidle --timeout 20000 2>&1 | tail -1

step "2. settings → AI Translate, enable, count ALL provider cards"
$AB eval "location.hash = '#/settings'; 'nav'"
$AB wait 1200 2>&1 | tail -1
$AB eval "(() => { const tab = Array.from(document.querySelectorAll('[role=tab], button')).find(b => (b.textContent||'').includes('AI Translate')); tab && tab.click(); return 'ok'; })()"
$AB wait 800 2>&1 | tail -1
$AB eval "(() => { const sw = document.querySelector('[role=switch]'); sw && sw.click(); return 'enabled'; })()"
$AB wait 400 2>&1 | tail -1
$AB eval "(() => { const grid = Array.from(document.querySelectorAll('button')).filter(b => b.querySelector('svg')); const labels = grid.map(c => c.textContent.trim().split('\n')[0]); return JSON.stringify({allSvgCards: labels}); })()"

step "3. select Liner AI + test, capture exact message"
$AB eval "(() => { const card = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').includes('Liner AI')); if (!card) return 'NO_LINER_CARD'; card.click(); return 'selected'; })()"
$AB wait 300 2>&1 | tail -1
$AB eval "(() => { const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').trim().startsWith('Test connection')); btn.click(); return 'testing'; })()"
$AB wait 10000 2>&1 | tail -1
$AB eval "(() => { const t = document.body.innerText; const idx = t.indexOf('Test connection'); return JSON.stringify({afterBtn: t.slice(idx, idx+260)}); })()"

step "4. network log for ai-translate"
$AB network requests --filter ai-translate 2>&1 | head -10
