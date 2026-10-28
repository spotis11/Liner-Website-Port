#!/bin/bash
# E2E repro: user flow — play a track, open fullscreen lyrics, press AI button,
# verify .blyrics--translated injection + store state + network call.
AB="agent-browser"
OUT=/home/z/my-project/download

step() { echo; echo "=== $1 ==="; }

$AB close 2>/dev/null | tail -1

step "1. fresh session + auth mock"
$AB network route "**/v1/me" --body '{"id":"e2e-user","email":"e2e@test.local","username":"e2etester","displayName":"E2E Tester"}' 2>&1 | tail -1
$AB network route "**/auth/refresh" --body '{"accessToken":"e2e-fake-token","accessTokenExpiresAt":1799999999000}' 2>&1 | tail -1
$AB open "http://127.0.0.1:3000/?v=repro1" 2>&1 | tail -1
$AB wait --load networkidle --timeout 20000 2>&1 | tail -1
$AB eval "localStorage.setItem('liner_auth_session', JSON.stringify({accessToken:'e2e-fake-token',refreshToken:'e2e-fake-refresh',accessTokenExpiresAt:Date.now()+3600e3,expiresAt:Date.now()+3600e3,user:{id:'e2e-user',email:'e2e@test.local',username:'e2etester',displayName:'E2E Tester'}})); 'seeded'"
$AB reload 2>&1 | tail -1
$AB wait --load networkidle --timeout 20000 2>&1 | tail -1

step "2. clear any stale ai-translate store (fresh user state)"
$AB eval "localStorage.removeItem('liner_ai_translate_v1'); 'cleared'"

step "3. search the track"
$AB eval "(() => { const inp = document.querySelector('input[type=text], input:not([type])'); if (!inp) return 'NO INPUT'; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(inp, 'Pano Zack Tabudlo'); inp.dispatchEvent(new Event('input', { bubbles: true })); return 'typed'; })()"
$AB wait 2500 2>&1 | tail -1
$AB snapshot -i -c 2>&1 | head -40

step "4. click first search result"
$AB eval "(() => { const items = Array.from(document.querySelectorAll('[class*=search] li, [class*=result] li, [class*=result] [role=button], [class*=search] [role=button]')); const t = items.find(el => (el.textContent||'').toLowerCase().includes('pano')); if (t) { t.click(); return 'clicked result'; } return 'no result: count=' + items.length; })()"
$AB wait 3000 2>&1 | tail -1
