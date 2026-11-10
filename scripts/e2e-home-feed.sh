#!/bin/bash
# E2E: home feed loads real content from the innertube (Riff-style) fallback.
# Runs in ONE call because background browser state dies between tool calls.
AB="agent-browser"

step() { echo; echo "=== $1 ==="; }
ok() { echo "  [OK] $1"; }
bad() { echo "  [BAD] $1"; }

step "1. fresh load -> guest login"
$AB open "http://localhost:3000/?e2e=homefeed" 2>&1 | tail -1
$AB wait --load networkidle --timeout 25000 2>&1 | tail -1
sleep 2
$AB eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(el => (el.textContent||'').includes('Continue as guest')); if (!b) return 'NOBTN'; b.click(); return 'clicked'; })()" 2>/dev/null
$AB wait --load networkidle --timeout 25000 2>&1 | tail -1
sleep 3
$AB eval "(() => { const go = Array.from(document.querySelectorAll('button')).find(el => /let.?s go/i.test(el.textContent||'')); if (go) { go.click(); return 'go'; } return 'no-onboarding'; })()" 2>/dev/null
sleep 4
SESS=$($AB eval "(() => { const s = localStorage.getItem('liner_auth_session'); if (!s) return 'NOSESSION'; const j = JSON.parse(s); return j.user ? 'user:' + (j.user.username || j.user.id) : 'NOUSER'; })()" 2>/dev/null)
echo "  session: $SESS"

step "2. home feed error message check"
$AB eval "location.hash = '#/'; 'home'" 2>/dev/null
$AB wait 4500 2>/dev/null | tail -1
FAILED=$($AB eval "document.body.innerText.includes(\"Couldn't load your home feed\")" 2>/dev/null)
[ "$FAILED" = "false" ] && ok "no 'couldn't load your home feed'" || bad "error message still shown: $FAILED"

step "3. section headings present"
$AB eval "JSON.stringify(['Your Mixes','Top Albums','Listening right now','Jump back in','Most listened of all time','Most saved'].map(h => h + ':' + document.body.innerText.includes(h)))" 2>/dev/null

step "4. track/card titles visible"
$AB eval "(() => { const titles = Array.from(document.querySelectorAll('span')).filter(s => s.className.includes('truncate')).map(s => s.textContent.trim()).filter(Boolean).slice(0, 14); return JSON.stringify(titles); })()" 2>/dev/null

step "5. youtube artwork cards on screen"
$AB eval "(() => { const imgs = Array.from(document.images).filter(i => (i.src||'').includes('yt3.googleusercontent.com') || (i.src||'').includes('i.ytimg.com')); return 'yt artwork imgs: ' + imgs.length; })()" 2>/dev/null

step "6. CORS sanity — zero direct youtubei/googlevideo browser fetches"
$AB eval "(() => { const res = performance.getEntriesByType('resource').map(r => r.name); return res.filter(n => n.includes('youtubei') || n.includes('googlevideo')).length + ' direct (must be 0), ' + res.filter(n => n.includes('/api/yt/')).length + ' proxied'; })()" 2>/dev/null

step "7. click a mix card -> collection page loads tracks"
$AB eval "location.hash = '#/'; 'home'" 2>/dev/null
sleep 2
$AB eval "(() => { const card = Array.from(document.querySelectorAll('.group')).find(c => c.textContent.includes('Daily Mix') || /Hits|Mix|This Is|Decade/i.test(c.textContent||'')); if (!card) return 'NO_CARD'; card.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true })); return 'clicked: ' + card.textContent.slice(0, 40); })()" 2>/dev/null
$AB wait 3500 2>/dev/null | tail -1
$AB eval "(() => { const body = document.body.innerText; return JSON.stringify({ hash: location.hash, hasPlayAllOrTracks: body.includes('Play') || /\\d+ tracks?|songs?/i.test(body), noLoadFail: !body.includes(\"Couldn't load\") }); })()" 2>/dev/null

step "8. play a home track (Quick picks) -> playback resolves via innertube chain"
$AB eval "location.hash = '#/'; 'home'" 2>/dev/null
sleep 2
$AB eval "(() => { const card = Array.from(document.querySelectorAll('.group')).find(c => c.querySelector('img') && (c.textContent||'').length > 10 && c.textContent.length < 80); if (!card) return 'NO_TRACK_CARD'; card.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true })); return 'clicked: ' + card.textContent.slice(0, 50); })()" 2>/dev/null
$AB wait 6000 2>/dev/null | tail -1
$AB eval "(() => { const t = document.querySelector('audio'); const bars = document.body.innerText; return JSON.stringify({ audioSrc: t ? (t.currentSrc||'').slice(0, 60) || '(empty)' : 'NO_AUDIO_EL', ready: t ? (t.readyState >= 2 || !t.paused) : false, nowPlaying: (bars.match(/Playing|Now playing/i) || [null])[0] }); })()" 2>/dev/null
