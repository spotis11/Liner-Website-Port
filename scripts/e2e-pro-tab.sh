#!/bin/bash
# E2E: Liner Pro tab (v1.19.0) — guest login, Settings → Liner Pro, six benefit
# cards, hero, CTA, search integration, light + dark screenshots.
# Runs in ONE call because background browser state dies between tool calls.
AB="agent-browser"
OUT=/home/z/my-project/download
mkdir -p "$OUT"

step() { echo; echo "=== $1 ==="; }

step "1. fresh load"
$AB open http://localhost:3000/ 2>&1 | tail -1
$AB wait --load networkidle --timeout 20000 2>&1 | tail -1

step "2. guest login via the real UI button"
$AB eval "(() => { const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Continue as guest')); if (!btn) return 'NO_GUEST_BTN'; btn.click(); return 'clicked'; })()"
$AB wait 2500 2>&1 | tail -1
$AB eval "(() => { const s = JSON.parse(localStorage.getItem('liner_auth_session')||'null'); return s ? 'session: ' + (s.user ? (s.user.username || s.user.displayName || 'user') : 'token-only') : 'NO_SESSION'; })()"

step "3. open settings"
$AB eval "location.hash = '#/settings'; 'nav'" 2>&1 | tail -1
$AB wait 1500 2>&1 | tail -1
$AB eval "(() => { const tabs = Array.from(document.querySelectorAll('[role=tab]')).map(b => b.textContent.trim()); return JSON.stringify({tabCount: tabs.length, hasPro: tabs.includes('Liner Pro')}); })()"

step "4. click the Liner Pro tab"
$AB eval "(() => { const tab = Array.from(document.querySelectorAll('[role=tab]')).find(b => b.textContent.trim() === 'Liner Pro'); if (!tab) return 'NO_PRO_TAB'; tab.click(); return 'clicked'; })()"
$AB wait 900 2>&1 | tail -1

step "5. verify Pro tab content"
$AB eval "(() => { const txt = document.body.innerText; const cards = Array.from(document.querySelectorAll('[data-testid^=pro-benefit-]')).map(c => c.getAttribute('data-testid')); const cta = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Get Liner Pro')); return JSON.stringify({ heroTitle: txt.includes('Liner Pro'), proPill: !!document.querySelector('span.tracking-\\\\[0.08em\\\\]') || txt.includes('PRO'), benefitCards: cards.length, cta: !!cta, b1: txt.includes('Doubled library limits'), b5000: txt.includes('5,000 liked tracks'), b2: txt.includes('Animated avatar and profile banner'), b3: txt.includes('Avatar frames and the Web badge'), b4: txt.includes('Full profile editor'), b5: txt.includes('Host listening rooms') && txt.includes('50 friends'), b6: txt.includes('Animated Pro sticker pack'), benefitsHeading: txt.includes('Included with Pro'), support: txt.includes('Questions about Pro?') }); })()"

step "6. screenshot (light)"
$AB screenshot "$OUT/e2e-pro-tab-light.png" 2>&1 | tail -1

step "7. dark mode"
$AB eval "(() => { document.documentElement.setAttribute('data-theme', 'dark'); return 'dark set: ' + document.documentElement.getAttribute('data-theme'); })()"
$AB wait 400 2>&1 | tail -1
$AB screenshot "$OUT/e2e-pro-tab-dark.png" 2>&1 | tail -1
$AB eval "(() => { document.documentElement.setAttribute('data-theme', 'light'); return 'restored light'; })()"

step "8. settings search finds the Pro tab"
$AB eval "(() => { const input = document.querySelector('input[aria-label*=\"settings\" i], input[aria-label*=\"Settings\"], input[placeholder]'); if (!input) return 'NO_SEARCH_INPUT'; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, 'sticker'); input.dispatchEvent(new Event('input', { bubbles: true })); return 'typed sticker'; })()"
$AB wait 700 2>&1 | tail -1
$AB eval "(() => { const tabs = Array.from(document.querySelectorAll('[role=tab]')).map(b => b.textContent.trim()); return JSON.stringify({visibleTabs: tabs, proStillVisible: tabs.includes('Liner Pro')}); })()"
$AB eval "(() => { const input = document.querySelector('input[placeholder]'); if (input) { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); } return 'cleared'; })()"

step "9. guest username (for cleanup)"
$AB eval "(() => { const s = JSON.parse(localStorage.getItem('liner_auth_session')||'null'); return s && s.user ? (s.user.username || 'no-username') : 'NO_USER'; })()"
