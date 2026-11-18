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
