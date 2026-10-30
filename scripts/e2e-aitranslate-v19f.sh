#!/bin/bash
# E2E v4: final verification — provider grid, live Liner AI test, logos shot.
AB="agent-browser"
OUT=/home/z/my-project/download

step() { echo; echo "=== $1 ==="; }

$AB close 2>/dev/null | tail -1

step "1. fresh session + auth mock + seed"
$AB network route "**/v1/me" --body '{"id":"e2e-user","email":"e2e@test.local","username":"e2etester","displayName":"E2E Tester"}' 2>&1 | tail -1
$AB network route "**/auth/refresh" --body '{"accessToken":"e2e-fake-token","accessTokenExpiresAt":1799999999000}' 2>&1 | tail -1
$AB open "http://127.0.0.1:3000/?v=19f" 2>&1 | tail -1
$AB wait --load networkidle --timeout 20000 2>&1 | tail -1
$AB eval "localStorage.setItem('liner_auth_session', JSON.stringify({accessToken:'e2e-fake-token',refreshToken:'e2e-fake-refresh',accessTokenExpiresAt:Date.now()+3600e3,expiresAt:Date.now()+3600e3,user:{id:'e2e-user',email:'e2e@test.local',username:'e2etester',displayName:'E2E Tester'}})); 'seeded'"
$AB reload 2>&1 | tail -1
$AB wait --load networkidle --timeout 20000 2>&1 | tail -1

step "2. settings → AI Translate → enable"
$AB eval "location.hash = '#/settings'; 'nav'"
$AB wait 1200 2>&1 | tail -1
$AB eval "(() => { const tab = Array.from(document.querySelectorAll('[role=tab], button')).find(b => (b.textContent||'').includes('AI Translate')); tab && tab.click(); return 'tab ok'; })()"
$AB wait 800 2>&1 | tail -1
$AB eval "(() => { const sw = document.querySelector('[role=switch]'); sw && sw.click(); return 'enabled'; })()"
$AB wait 400 2>&1 | tail -1

step "3. provider cards (all 7, Liner AI first + Free)"
$AB eval "(() => { const names = ['Liner AI','Google Translate','OpenRouter','Gemini','OpenAI','Claude','Ollama']; const found = names.map(n => { const b = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').trim().startsWith(n)); return b ? n : 'MISSING:'+n; }); return JSON.stringify(found); })()"
$AB eval "(() => { const html = document.body.innerHTML; return JSON.stringify({gtOfficial: html.includes('4285F4') && html.includes('DBDBDB'), geminiOfficial: html.includes('00B95C'), claudeOrange: html.includes('D97757'), openaiGlyph: html.includes('M21.55'), linerTile: html.includes('liner-ai-tile')}); })()"

step "4. LIVE TEST — Liner AI (default)"
$AB eval "(() => { const card = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').includes('Liner AI')); card && card.click(); return 'liner'; })()"
$AB wait 300 2>&1 | tail -1
$AB eval "(() => { const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').trim().startsWith('Test connection')); btn.click(); return 'testing'; })()"
$AB wait 10000 2>&1 | tail -1
$AB eval "(() => { const t = document.body.innerText; const idx = t.indexOf('Test connection'); return JSON.stringify({ok: t.includes('Translation works'), fail: t.includes('Test failed'), detail: t.slice(idx, idx+180)}); })()"

step "5. screenshot (provider grid with real logos)"
$AB eval "(() => { const el = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').includes('OpenRouter')); el && el.scrollIntoView({block:'center'}); return 'scrolled'; })()"
$AB wait 400 2>&1 | tail -1
$AB screenshot "$OUT/aitranslate_v19_final.png" 2>&1 | tail -1
