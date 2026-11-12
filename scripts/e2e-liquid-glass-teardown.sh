#!/bin/bash
# E2E v3: Liquid Glass teardown — toggle OFF via the real UI, verify lenses
# destroyed, chrome backgrounds restored, no leftover canvases.
AB="agent-browser"
OUT=/home/z/my-project/download
mkdir -p "$OUT"

step() { echo; echo "=== $1 ==="; }

step "1. boot with glass enabled + playing"
$AB open http://localhost:3000/ 2>&1 | tail -1
$AB wait --load networkidle --timeout 20000 2>&1 | tail -1
$AB eval "(() => { localStorage.setItem('liner_web_liquid_glass_v1', JSON.stringify({ enabled: true })); const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Continue as guest')); if (btn) { btn.click(); return 'guest clicked'; } return 'NO_BTN'; })()"
$AB wait 2500 2>&1 | tail -1
$AB eval "(() => { const card = document.querySelector('.group.cursor-pointer'); if (!card) return 'NO_CARD'; card.click(); return 'clicked'; })()"
$AB wait 6000 2>&1 | tail -1
$AB eval "(() => { const card = document.querySelector('.group.cursor-pointer'); if (!card) return 'NO_CARD'; card.click(); return 'replayed'; })()"
$AB wait 6000 2>&1 | tail -1
$AB eval "(() => JSON.stringify({ panes: document.querySelectorAll('[data-liquid-glass-pane]').length, canvases: document.querySelectorAll('[data-liquid-glass-pane] canvas').length, mini: !!document.querySelector('[data-liquid-ignore]') }))"

step "2. open Settings via hash"
$AB eval "(() => { location.hash = '#/settings'; return 'nav'; })()"
$AB wait 1500 2>&1 | tail -1
$AB eval "(() => { const tabs = Array.from(document.querySelectorAll('[role=tab]')).map(t => t.textContent.trim()); return JSON.stringify({ tabs }); })()"

step "3. click Appearance tab"
$AB eval "(() => { const tab = Array.from(document.querySelectorAll('[role=tab]')).find(t => t.textContent.trim() === 'Appearance'); if (!tab) return 'NO_TAB'; tab.click(); return 'ok'; })()"
$AB wait 900 2>&1 | tail -1
$AB eval "(() => { const block = Array.from(document.querySelectorAll('button')).filter(b => (b.getAttribute('aria-label')||'').includes('Liquid glass') || b.textContent.trim().startsWith('Liquid glass')); return JSON.stringify({ toggles: block.map(b => ({ label: b.getAttribute('aria-label') || b.textContent.trim().slice(0, 30), pressed: b.getAttribute('aria-pressed') })) }); })()"

step "4. toggle OFF"
$AB eval "(() => { const block = Array.from(document.querySelectorAll('button')).find(b => (b.getAttribute('aria-label')||'').includes('Liquid glass') || b.textContent.trim().startsWith('Liquid glass')); if (!block) return 'NO_TOGGLE'; block.click(); return 'off'; })()"
$AB wait 3000 2>&1 | tail -1
$AB eval "(() => { const mini = document.querySelector('[data-liquid-ignore]'); return JSON.stringify({ panes: document.querySelectorAll('[data-liquid-glass-pane]').length, canvases: document.querySelectorAll('[data-liquid-glass-pane] canvas').length, persisted: localStorage.getItem('liner_web_liquid_glass_v1'), miniStillIgnored: !!mini, liquidGLStillLoaded: typeof window.liquidGL }); })()"

step "5. chrome background restored (mini player has its classes back)"
$AB eval "(() => { location.hash = '#/'; const mini = Array.from(document.querySelectorAll('div')).find(d => d.className && String(d.className).includes('h-[64px]') && String(d.className).includes('overflow-hidden')); return JSON.stringify({ miniFound: !!mini, miniClasses: mini ? String(mini.className).slice(0, 120) : null }); })()"
$AB wait 1500 2>&1 | tail -1
$AB screenshot "$OUT/v120_glass_off_restored.png" 2>&1 | tail -1
$AB errors 2>&1 | tail -6
$AB close 2>&1 | tail -1
echo; echo "TEARDOWN E2E DONE"
