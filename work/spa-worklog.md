# SPA worklog (recreated 2026-11-18 — the previous log was lost in the sandbox recycle)

## 2026-11-18 — v1.23.0: full 0.2.12 redesign behind the App design (UI) picker

Shipped to running.sh: dep_adyfxyp2qpiyfa7fimhs (active), project
prj_qlg6u7iilas32ilkbv4j, service svc_vkzivjf5qsvnv3sivtbn
(liner-web-liner-bot-f3eq.running.sh). Local :3000 verified first, then the
platform upload via scripts/running_deploy_web.sh with a fresh API token.

### Architecture
- src/ = merged upstream 0.2.12 redesign (git 3-way merge: base seed 43710b07
  = 0.2.10, ours = the website fork at 86f528e7, theirs = liner-new-ui.zip).
  211 conflict hunks resolved by hand; the whole website layer survived
  (api relay, announcements, changelog, showcase, userfinder, moderation,
  discord gateway, guest login, human-check web behavior).
- src-classic/ = frozen byte-for-byte snapshot of the pre-merge UI, alias
  @classic. It IS the "Original" design (the default).
- main.tsx reads uiStyle synchronously from localStorage and dynamic-imports
  exactly one design tree; every storage key is shared, so switching (the
  Liner "please refresh" prompt does a hard reload) keeps the session.
- loginUi was renamed uiStyle (whole-app switch, legacy field read for
  migration). The Appearance row is titled "UI" and shows two real library
  screenshots (public/ui-preview-original.jpg / ui-preview-new.jpg — the
  redesign one has its toast banners blurred out).

### Window controls: REMOVED everywhere
WindowControls.tsx + its test + WindowControlsNotch are deleted in the merged
tree; the Header island, RootErrorFallback and the redesign LoginPage render
nothing. The classic tree ships its own stub. No minimize/maximize/close
anywhere on the web.

### Post-merge repair (commit cfa29b4d)
- api: checkUsername + signOutTasks registry; contracts: UsernameAvailability
- saved store: upstream sign-out guard ported onto the relay-backed store
- preload: optional notePresence + shortcut-status hooks
- innertube WEB_PROFILE, linerDb listAudioIds, EntityHero HERO_CHIP_CLASS,
  shared/ui barrel = union of both designs' exports
- SettingsModal composed on the new sidebar shell with every website tab
- 2392/2392 vitest green (both trees), tsc -b clean, vite build clean

### Ops incident during deploy (fixed)
The recycle wiped the gitignored .env. Rebuilt it from the 2026-11-17 rearm
recipe (DATABASE_URL file:./db/custom.db, DISCORD_CLIENT_ID, public base +
redirect, fresh DB_MIRROR_EXPORT_KEY). Platform-side secrets (Discord client
secret, SMTP, service email) live on the running.sh variables page and are
injected at boot; verify_standalone_env.py passes. package.json build now
tolerates a missing .env with a warning instead of aborting.

### Live E2E (https://liner-web-liner-bot-f3eq.running.sh)
- default = original design, login shows classic art, Discord + Guest work
- Settings → Appearance → UI: thumbnails render; Original checked
- switch to New → refresh prompt → hard reload → full redesign, same session,
  no window controls, new settings shell carries all website tabs
- switch back to Original → classic restored, session intact
- note: Cloudflare served a stale "/" HTML for a few minutes after the deploy
  (max-age=0 revalidation); direct /liner/index.html was fresh immediately.

## 2026-11-18 (later) — v1.23.1 hotfix: new-UI Changelog + proxied sign-in

User-reported on the redesign: (1) the sidebar Changelog did nothing and the
console flooded with `Cannot read properties of undefined (reading
'pathname')`, (2) upstream-account sign-in dead-ended on Cloudflare.

Root causes + fixes:
- The redesign sidebar renders every nav item as `<Link to={item.href}>`, but
  the website's changelog item has no href (it is a modal, not a route) —
  `Link to=undefined` threw on every render. SidebarNavItems now renders
  href-less items as buttons; changelog calls useChangelogStore.toggleOpen so
  the website's ChangelogModal opens exactly like the classic sidebar.
- Upstream's auth challenge began demanding its Turnstile widget on login.
  The widget is domain-locked to Liner hostnames (error 110200) and the page
  sits behind X-Frame-Options, so no web deployment can ever run it. The
  relay now strips the turnstile section from login challenges (register
  keeps the prompt + guidance); upstream answers the PoW-signed login with a
  real JSON error, which the form displays ("Email or password is incorrect."
  — verified with the owner's own credentials, which upstream rejects).
- /v1/me/library/* 401s were the failed-login cascade, not an independent bug.
- deploy.sh: restart now kills whoever holds :3000 (parsed from ss -ltnp — no
  fuser on this box); the old restart raced and left stale orphan servers
  serving old bundles/envs (which is also what broke the guest DB open).
- .env DATABASE_URL pinned absolute (file:/home/z/my-project/db/custom.db).

Shipped: dep_qenaoiozrjh7eqk4hryr (active), live bundle index-C6tqjeV4.js.
Verified live: redesign Changelog opens with real release notes, no pathname
errors, guest + announcement flows healthy.

## 2026-11-18 (evening) — upstream sign-in: TURNSTILE_REQUIRED popup flow

Live login answered 403 TURNSTILE_REQUIRED ("Complete the human check first.")
— upstream's risk engine demands its Turnstile widget for the running.sh
egress IP (intermittent; the same call later passed token-less and returned
an honest INVALID_CREDENTIALS for the owner's test credentials). The widget
is domain-locked to Liner origins and the WAF sets X-Frame-Options, so it can
never run framed — but a TOP-LEVEL popup on Liner's own origin is solvable
(the Cloudflare interstitial renders first-party) and the page answers over
postMessage, the same channel the desktop uses.

- relay: reverted the login challenge strip — upstream's turnstile section
  now passes through so the SPA prompts exactly when upstream demands it
  (clean egresses keep the prompt-free PoW path). Auth failure logging kept.
- api.ts (both trees): withAuthProof catches TURNSTILE_REQUIRED/INVALID on
  login/register, opens the human check (popup) and retries once with the
  fresh token.
- CheckFrame (both trees): web renders CheckWindow — "Open verification
  window" (window.open + postMessage listener matching the popup + closed
  polling); Electron keeps the iframe path. Store no longer preblocks.
- authErrorMessage: TURNSTILE_* fallback text instead of a silent swallow.

Shipped dep_weurj2h3mavrdwmsgkns (active, index-DD7plhCH.js). Verified live:
login reaches upstream's real credential check (INVALID_CREDENTIALS displayed
honestly); register triggers the human-check dialog with the popup button and
the popup opens upstream's verify page (Cloudflare hard-blocks the headless
fingerprint — a real browser gets the solvable interstitial). The final
token->postMessage hop is the desktop's protocol and needs a human to solve.

## 2026-11-18 (late) — the widget wall is real for blocked networks

User's real browser got Cloudflare's hard block page ("Sorry, you have been
blocked", their IP 5.107.210.32) on the verify popup — Liner's provider blocks
their network outright, so the popup check cannot complete for them without a
clean network. Probes: challenge gate currently required 8/8 for login AND
register from the relay egress (flips over hours — a token-less login passed
earlier and returned the honest INVALID_CREDENTIALS). No alternate upstream
exists: api.tryliner.com NXDOMAIN, api.getliner.com alive but a different
(older) API generation with no /v1/auth routes.

Shipped (dep_obsazlfzoeoeqmiueajf, index-DvRtGZPQ.js):
- human-check failed phase: honest guidance (network blocked / ad-blocker or
  extensions / VPN for the one-time check / Ray ID to Liner support / retry
  later) + a "Try without verification" action that proceeds token-less —
  wins whenever upstream's gate has flipped off (both UI trees)
- a 60s declined flag so a TURNSTILE_REQUIRED answer right after "try without"
  never re-opens the dialog in a loop
- en.json strings updated (other locales fall back to en per key)

Local E2E on the shipped bundle: challenge-required -> dialog -> popup closed
unsolved -> guidance + try-without -> single token-less login -> 403 surfaced
honestly, no loop. Live: same bundle, dialog renders on submit.
User-facing reality: their credentials also came back INVALID_CREDENTIALS when
the gate was off — they should re-check the real Liner email/password; and
their SW serves the shell network-first so the next visit picks this build up.

## 2026-11-18 (late 2) — credentials puzzle + guest 401 noise

User reports seekfromohio@gmail.com is suspended (official app fails too) but
goodbye42@gmail.com + the same password works in the official app. Live relay
login for goodbye42 reached the real credential check (gate was off) and still
got INVALID_CREDENTIALS. My login body is byte-identical to the official
desktop's ({email, password, pow, turnstile} -> /v1/auth/login), so the shape
is right; the working official app on the user's network proves their IP is
not WAF-blocked for API traffic — only the verify PAGE is. Conclusion: up-
stream most likely answers a generic INVALID_CREDENTIALS to auth from the
relay's datacenter egress (bot suspicion), and a turnstile token attached to
the login may be the risk-lifter. User-side discriminators: (1) fully sign
out in the official app and re-sign-in to truly verify the password; (2) if
official re-sign-in works, do the one-time popup check on a VPN, then sign in
via the fork. The fork's own Discord button (relay-local OAuth, /api/auth/
discord/start) is a working site-account alternative that never touches
Liner's Cloudflare.

Shipped (dep_aj7ifhupiqng6zmwmmpt, index-BgylCuwj.js): guest-state 401 storm
fixed — isRetryable no longer retries 401 (api layer already refreshes), and
useDailyMixes/useRecentlyPlayed skip the /v1/me/* calls entirely for guests
(both UI trees). Verified: zero /v1/me requests in guest state, locally and
live.

## 2026-11-19 — MATERIAL 3 design + ai-translate fallback + gstatic CORS

User asked for a new "MATERIAL 3" design mode built from riff's source
(github.com/rootscripts/riff), redesigning progress bar/buttons/toggles, plus
fixes for /api/ai-translate 502 and gstatic image CORS errors.

M3 (dep_wvsrhpf5jwbgzqqrri7b, bundle index-DVJbln3W.js):
- appearanceStore: UiStyle gains "material3" (third card in Settings →
  Appearance, preview public/ui-preview-material3.jpg generated from an M3
  mock). main.tsx loads the src/ tree for it and sets
  html[data-ui-style="material3"].
- src/material3/: material3.css (riff's M3 dark palette #121214/#5247d1 +
  standard M3 light, remapped onto the fork's --bg-/--text-/--accent-/
  --radius tokens with !important so a chosen color theme can't fight it;
  riff's 52×32 switch with 16→24px thumb and spring easing; M3 slider skin;
  focus rings; scrollbars), ripples.ts (delegated pointerdown ripple engine),
  material3.ts (activation entry, dynamically imported only in M3 mode).
- TimelineSlider: data-m3-slider/data-dragging hooks + an M3 thumb span that
  scales in on hover/drag (sibling of the overflow-hidden track).
- Verified live: tokens, nav pill, 52×32 switch geometry + toggle, ripple
  spawn, MATERIAL 3 card; screenshots in download/.

ai-translate 502: two layers. (1) the deployed server had no .z-ai-config —
running_deploy_web.sh now stages /etc/.z-ai-config into the standalone root.
(2) running.sh's egress gets ECONNRESET against internal-api.z.ai — route.ts
gained a MyMemory fallback (translateViaMyMemory, chunked concurrency, entity
decoding) with a 10-minute SDK cooldown on failure. Verified live: real
translations returned ("langit biru malam ini").

gstatic CORS: gstatic.com added to webProxy MEDIA_HOSTS; coverArt's two
img.src assignments route through rewriteForWeb (same-origin /api/media) so
canvas color extraction stays untainted. Library page now shows zero direct
gstatic loads.
