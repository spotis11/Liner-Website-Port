#!/bin/bash
# E2E v2: Liquid Glass (v1.20.0) — with real playback so the mini player and
# its liquidGL lens actually mount. ONE call (browser state dies between calls).
AB="agent-browser"
OUT=/home/z/my-project/download
mkdir -p "$OUT"

step() { echo; echo "=== $1 ==="; }

step "1. fresh load + guest login"
$AB open http://localhost:3000/ 2>&1 | tail -1
$AB wait --load networkidle --timeout 20000 2>&1 | tail -1
$AB eval "(() => { const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Continue as guest')); if (!btn) return 'NO_GUEST_BTN'; btn.click(); return 'clicked'; })()"
$AB wait 2500 2>&1 | tail -1

step "2. click a Popular tracks card -> playback starts"
$AB eval "(() => { const card = Array.from(document.querySelectorAll('div.group')).find(d => d.className.includes('w-[175px]') && d.onclick); if (!card) { const any = document.querySelector('.group.cursor-pointer'); if (!any) return 'NO_CARD'; any.click(); return 'clicked fallback card'; } card.click(); return 'clicked card'; })()"
$AB wait 6000 2>&1 | tail -1
$AB eval "(() => { const audio = document.querySelector('audio'); const mini = Array.from(document.querySelectorAll('div')).find(d => d.className && String(d.className).includes('h-[64px]')); return JSON.stringify({ audioEl: !!audio, audioSrc: audio ? (audio.currentSrc || '(pending)').slice(0, 50) : null, miniMounted: !!mini }); })()"

step "3. enable Liquid Glass via the persisted record (no UI needed)"
$AB eval "(() => { localStorage.setItem('liner_web_liquid_glass_v1', JSON.stringify({ enabled: true })); location.reload(); return 'glass seeded + reload'; })()"
$AB wait --load networkidle --timeout 20000 2>&1 | tail -1
$AB wait 5000 2>&1 | tail -1

step "4. verify the lens mounted on the mini player"
$AB eval "(() => { const panes = Array.from(document.querySelectorAll('[data-liquid-glass-pane]')); const canvases = panes.flatMap(p => Array.from(p.querySelectorAll('canvas'))); const mini = document.querySelector('[data-liquid-ignore]'); const paneInMini = mini ? !!mini.querySelector(':scope > [data-liquid-glass-pane]') : false; const pr = panes[0] ? panes[0].getBoundingClientRect() : null; const mr = mini ? mini.getBoundingClientRect() : null; return JSON.stringify({ paneCount: panes.length, canvasCount: canvases.length, canvasRes: canvases[0] ? canvases[0].width + 'x' + canvases[0].height : null, paneRect: pr ? Math.round(pr.width) + 'x' + Math.round(pr.height) : null, miniRect: mr ? Math.round(mr.width) + 'x' + Math.round(mr.height) : null, aligned: pr && mr ? (Math.abs(pr.top - mr.top) < 2 && Math.abs(pr.width - mr.width) < 2) : false, persisted: localStorage.getItem('liner_web_liquid_glass_v1') }); })()"

step "5. background: does the engine snapshot the page (main registered dynamic)?"
$AB eval "(() => { const dyn = document.querySelector('main'); const canvases = Array.from(document.querySelectorAll('[data-liquid-glass-pane] canvas')); const style = getComputedStyle(canvases[0] || document.body); return JSON.stringify({ hasMain: !!dyn, canvasVisible: canvases[0] ? style.visibility + '/' + style.opacity : null, windowLiquidGL: typeof window.liquidGL }); })()"

step "6. screenshot: glass mini player over content (light)"
$AB eval "(() => { location.hash = '#/'; return 'home'; })()"
$AB wait 2500 2>&1 | tail -1
$AB screenshot "$OUT/v120_glass_miniplayer_light.png" 2>&1 | tail -1

step "7. dark shot"
$AB eval "(() => { document.documentElement.setAttribute('data-theme','dark'); return 'dark'; })()"
$AB wait 600 2>&1 | tail -1
$AB screenshot "$OUT/v120_glass_miniplayer_dark.png" 2>&1 | tail -1
$AB eval "(() => { document.documentElement.setAttribute('data-theme','light'); return 'light restored'; })()"

step "8. open the queue drawer (second glass surface)"
$AB eval "(() => { const btn = Array.from(document.querySelectorAll('button')).find(b => /queue/i.test(b.getAttribute('aria-label')||'')); if (!btn) return 'NO_QUEUE_BTN'; btn.click(); return 'queue clicked'; })()"
$AB wait 2000 2>&1 | tail -1
$AB eval "(() => { const panes = Array.from(document.querySelectorAll('[data-liquid-glass-pane]')); return JSON.stringify({ paneCount: panes.length, allWithCanvas: panes.every(p => p.querySelector('canvas')) }); })()"
$AB screenshot "$OUT/v120_glass_queue_drawer.png" 2>&1 | tail -1

step "9. disable via UI toggle (Settings -> Appearance) -> teardown"
$AB eval "(() => { location.hash = '#/settings'; return 'nav'; })()"
$AB wait 1200 2>&1 | tail -1
$AB eval "(() => { const tab = Array.from(document.querySelectorAll('[role=tab], button')).find(b => b.textContent.trim() === 'Appearance'); if (tab) { tab.click(); return 'tab'; } return 'NO_TAB'; })()"
$AB wait 800 2>&1 | tail -1
$AB eval "(() => { const block = Array.from(document.querySelectorAll('button')).find(b => (b.getAttribute('aria-label')||'').includes('Liquid glass') || b.textContent.trim().startsWith('Liquid glass')); if (!block) return 'NO_TOGGLE'; block.click(); return 'toggled off'; })()"
$AB wait 2500 2>&1 | tail -1
$AB eval "(() => { const panes = document.querySelectorAll('[data-liquid-glass-pane]').length; const canvases = document.querySelectorAll('[data-liquid-glass-pane] canvas').length; const mini = document.querySelector('[data-liquid-ignore]'); return JSON.stringify({ paneCount: panes, canvasCount: canvases, persisted: localStorage.getItem('liner_web_liquid_glass_v1'), chromeRestored: !mini }); })()"

step "10. console errors"
$AB errors 2>&1 | tail -8
$AB close 2>&1 | tail -1
echo; echo "E2E DONE"
