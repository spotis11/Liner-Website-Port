#!/bin/bash
# E2E: AI Translate v1.9 — settings UI with real brand logos + live translation test.
# Single-call harness (browser state dies between tool calls — known trap).
AB="agent-browser"
OUT=/home/z/my-project/download
mkdir -p "$OUT"

step() { echo; echo "=== $1 ==="; }

step "1. mock auth endpoints, seed session, reload"
$AB network route "**/v1/me" --body '{"id":"e2e-user","email":"e2e@test.local","username":"e2etester","displayName":"E2E Tester"}' 2>&1 | tail -1
$AB network route "**/auth/refresh" --body '{"accessToken":"e2e-fake-token","accessTokenExpiresAt":1799999999000}' 2>&1 | tail -1
$AB eval "localStorage.setItem('liner_auth_session', JSON.stringify({accessToken:'e2e-fake-token',refreshToken:'e2e-fake-refresh',accessTokenExpiresAt:Date.now()+3600e3,expiresAt:Date.now()+3600e3,user:{id:'e2e-user',email:'e2e@test.local',username:'e2etester',displayName:'E2E Tester'}})); 'seeded'"
$AB reload 2>&1 | tail -1
$AB wait --load networkidle --timeout 20000 2>&1 | tail -1
$AB eval "(s => s ? 'authed as ' + s.user.username : 'NO_SESSION')(JSON.parse(localStorage.getItem('liner_auth_session')||'null'))"

step "2. open settings → AI Translate tab"
$AB eval "location.hash = '#/settings'; 'nav'"
$AB wait 1200 2>&1 | tail -1
$AB eval "(() => { const tab = Array.from(document.querySelectorAll('[role=tab], button')).find(b => (b.textContent||'').includes('AI Translate')); if (!tab) return 'NO_AITAB'; tab.click(); return 'clicked'; })()"
$AB wait 800 2>&1 | tail -1

step "3. provider grid — count + real logos"
$AB eval "(() => { const logos = document.querySelectorAll('.liner-brand-logo svg'); const cards = Array.from(document.querySelectorAll('button')).filter(b => b.querySelector('.liner-brand-logo')); const labels = cards.map(c => c.textContent.trim().split('\n')[0]); return JSON.stringify({logoSvgs: logos.length, cards: labels}); })()"

step "4. colored official logos present (Google Translate + Gemini + Claude orange)"
$AB eval "(() => { const html = document.body.innerHTML; return JSON.stringify({gtBlue: html.includes('4285F4'), gtGray: html.includes('DBDBDB'), geminiGreen: html.includes('00B95C'), claudeOrange: html.includes('D97757'), linerTile: html.includes('liner-ai-tile')}); })()"

step "5. live test connection (Liner AI default) — full chain"
$AB eval "(() => { const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').trim().startsWith('Test connection')); if (!btn) return 'NO_TEST_BTN'; btn.click(); return 'clicked'; })()"
$AB wait 9000 2>&1 | tail -1
$AB eval "(() => { const t = document.body.innerText; const ok = t.includes('Translation works'); const fail = t.includes('Test failed'); const m = t.match(/Hello world[^\n]*/); return JSON.stringify({ok, fail, sample: m ? m[0].slice(0,120) : null}); })()"

step "6. switch provider to Google Translate, test again (browser-direct path)"
$AB eval "(() => { const card = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').includes('Google Translate')); if (!card) return 'NO_GOOGLE_CARD'; card.click(); return 'selected'; })()"
$AB wait 400 2>&1 | tail -1
$AB eval "(() => { const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').trim().startsWith('Test connection')); if (!btn) return 'NO_TEST_BTN'; btn.click(); return 'clicked'; })()"
$AB wait 12000 2>&1 | tail -1
$AB eval "(() => { const t = document.body.innerText; const ok = t.includes('Translation works'); const fail = t.includes('Test failed'); const m = t.match(/Hello world[^\n]*/); return JSON.stringify({ok, fail, sample: m ? m[0].slice(0,120) : null}); })()"

step "7. screenshot"
$AB screenshot "$OUT/aitranslate_settings_logos.png" 2>&1 | tail -1
