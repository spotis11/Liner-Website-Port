// Liner web-port changelog.
//
// One entry per release — the sidebar Changelog button shows exactly what was
// added or fixed after every website update. Dates are ISO; newest first.

export type ChangelogEntryType = "added" | "fixed" | "changed";

export interface ChangelogEntry {
  type: ChangelogEntryType;
  text: string;
}

export interface ChangelogRelease {
  version: string;
  date: string;
  title: string;
  entries: ChangelogEntry[];
}

export const CHANGELOG: ChangelogRelease[] = [
  {
    version: "1.14.0",
    date: "2026-11-11",
    title: "Sign in with Discord",
    entries: [
      {
        type: "added",
        text: "The login screen has a \"Continue with Discord\" button. One tap bounces you through Discord's own authorize screen and back — a website account is created automatically from your Discord profile (avatar, display name, username), or linked to your existing account when the emails match. The flow runs on Discord's official OAuth2 with a PKCE proof and a one-time state check, so nothing but Discord itself can complete a sign-in. Cancelled prompts and failures land back on a friendly error card with a way back to the sign-in form.",
      },
    ],
  },
  {
    version: "1.13.5",
    date: "2026-11-11",
    title: "Fullscreen player: vertical with lyrics, horizontal without",
    entries: [
      {
        type: "changed",
        text: "The fullscreen player shape now follows the Lyrics toggle again: with the lyrics pane on you get the classic vertical layout (cover art stacked above the timeline and controls, lyrics filling the right half), and turning the Lyrics pill off — or playing a track with no lyrics — settles into the compact horizontal layout with the cover beside the controls. The pane slide/fade choreography, the remembered preference and the AI translate button are unchanged.",
      },
    ],
  },
  {
    version: "1.13.4",
    date: "2026-11-11",
    title: "Fullscreen player: horizontal layout",
    entries: [
      {
        type: "changed",
        text: "The fullscreen player no longer stacks the cover art on top of the controls while lyrics are open. It now always uses the horizontal layout — cover art on the left with the title, timeline and transport controls beside it — while the lyrics fill the right half, matching the reference look. The Lyrics toggle choreography (pill press, pane slide, remembered preference) is unchanged, and the no-lyrics \"No lyrics found\" state keeps its compact horizontal arrangement.",
      },
    ],
  },
  {
    version: "1.13.3",
    date: "2026-11-11",
    title: "Website updates no longer sign you out",
    entries: [
      {
        type: "fixed",
        text: "Every website update used to wipe the live database with the build machine's stale copy — every session died (everyone signed out) and guest accounts lost their library. The deploy package no longer carries a database file: your data now stays on the server across updates, backed by a continuously-written JSON mirror that the server restores automatically if the database ever comes up empty (the same self-healing the ban list already had). Signed in once, signed in for good — updates included.",
      },
    ],
  },
  {
    version: "1.13.2",
    date: "2026-11-11",
    title: "The Lyrics button is back",
    entries: [
      {
        type: "added",
        text: "The fullscreen \"Lyrics\" pill is back — now inside the top-left glass notch next to the close button. Pressing it springs the pill, fires one expanding ring and slides the music glyph in while the lyrics pane choreographs away (0.5s expo curve, the pane slides + fades as the player glides back to center). Your choice is remembered across sessions, and the lyrics status in the top notch (switcher, \"No lyrics found\", instrumental, loading) only shows while the pane is open.",
      },
      {
        type: "fixed",
        text: "Finished the Local Music removal: the desktop half of the feature (local file import IPC and scheme) is gone for good, no dead imports left, and the storage settings no longer list a Local Music category. The type check now passes on a fresh checkout again.",
      },
    ],
  },
  {
    version: "1.13.1",
    date: "2026-11-10",
    title: "The fullscreen player is now the new one — and lyrics load again",
    entries: [
      {
        type: "changed",
        text: "The fullscreen player is the real new upstream player now, pixel for pixel: the fork's Song/Video tabs and the separate \"Lyrics\" on/off button are gone (the pane is always shown, exactly like the desktop app), the player column sits centered on the left and glides into a compact horizontal layout on short windows, and everything breathes with the upstream spring animations — cover, track info, timeline and controls all reflow together with framer-motion layout transitions. \"No lyrics found\", \"instrumental\" and the loading state now appear in the glass notch at the top center, the lyrics switcher moved into the same notch, and the background, glass frame and ambient layer are the upstream ones.",
      },
      {
        type: "changed",
        text: "Lyrics draw on the upstream canvas renderer (word-level sweep, free-scroll that hands back to autoscroll after a few seconds, tap a line to seek) with the AI Translate fork riding along: translated lines render as a subtitle under each line, the way the desktop shows native translations, and the AI toggle moved to its own glass notch at the top right.",
      },
      {
        type: "fixed",
        text: "Lyrics load again. The site backend used to answer every lyrics request with a clean 404, so the fullscreen player said \"Failed to load lyrics.\" for everything. The backend now streams real lyrics server-side from LRCLIB (open, no auth, exact-match first then ranked search) in the same event shape the desktop backend uses — line-synced LRC whenever the release has it, plain text otherwise, quality-scored against your track's title, artist and duration. The sound wave visualizer toggle still works for those who turned it on.",
      },
    ],
  },
  {
    version: "1.13.0",
    date: "2026-11-10",
    title: "Our own accounts + guest mode, a cleaner sidebar, and the newest fullscreen player",
    entries: [
      {
        type: "added",
        text: "Our own login system. Sign-up and sign-in no longer touch Liner's upstream servers (whose bot-wall made logging in impossible from many networks): accounts now live in this website's own database and are permanent — they survive restarts and republishes. Passwords are stored scrypt-hashed, sessions rotate their refresh tokens on every use, and your liked songs and playlists are stored per-account on the site too, so a logged-in library actually works end to end.",
      },
      {
        type: "added",
        text: "Guest mode. One tap on the new \"Continue as guest\" button on the login screen drops you straight into the app — no email, no password, no captcha. A guest is a real (private) account in the same database, so everything you do is kept for your next visit, not thrown away when the browser closes.",
      },
      {
        type: "changed",
        text: "The fork-only Downloads tab, the separate Local Music tab and the old 10-band equalizer modal are gone — the sidebar is back to the clean upstream set (Home, Search, Library, Changelog, Settings), local files stay reachable from the Library page, and the equalizer is the upstream quick picker in the player's tuning popup.",
      },
      {
        type: "changed",
        text: "The fullscreen player is synced with the newest upstream Liner: plain-text TTML lyrics now render as untimed lines instead of a blank pane, lyrics providers that return garbage (LRC headers, markup) are filtered out and the switcher auto-falls over to a provider that actually has text, the provider island stays available when the active provider has no text, and the mini player's progress bar eases through seeks and track changes instead of crawling for a second. The lyrics pill itself got a proper press animation — a springy tap, one expanding ring, and the music glyph sliding in as the pane choreographs across.",
      },
      {
        type: "changed",
        text: "No more CORS, ever. The app stopped talking to Liner's upstream API from the browser entirely: every remaining upstream-shaped request (home feed, explore, presence, history, saved collections, lyrics lookup) now goes to this website's own /v1 backend, same-origin and preflight-free, so nothing can be blocked by the upstream bot-wall any more. Daily mixes are built from your own liked tracks, and the popular list on Home and in the Library is now the site's most-liked tracks, straight from our database.",
      },
      {
        type: "fixed",
        text: "The home screen loads for everyone now. Our own /v1 backend only knows about this site's accounts, so a fresh visitor's home feed was all empty and just said \"couldn't load your home feed\". The empty sections now fall back to YouTube Music's own home screen (the same innertube API the desktop client Riff uses, through the site's same-origin proxy): Quick picks become \"Listening right now\" and \"Most listened of all time\", the New releases shelf becomes Top Albums, playlist carousels become Most saved, and four of them become playable Your Mixes — covers, artists and full track lists included. If YouTube's anonymous feed rotates without a track shelf, the charts playlist is fetched so the track sections always have content.",
      },
      {
        type: "fixed",
        text: "Playback hardening ported from upstream: a googlevideo host that simply cannot be reached now counts as a refused network (so you get the honest \"YouTube refused every audio stream from this network\" message instead of a dead-track error), signed-in TV failures are carried into the fallback error so nothing is silently swallowed, and the desktop build's CORS handling keeps credentialed headers only for Liner hosts so googlevideo SABR streams keep working.",
      },
    ],
  },
  {
    version: "1.12.2",
    date: "2026-11-02",
    title: "Maintenance mode — take the whole site down with one switch",
    entries: [
      {
        type: "added",
        text: "Maintenance mode. From the Moderation tab the site owner can now put the entire website behind a forced maintenance wall: a branded full-screen page (Liner logo, \"Currently on Maintenance!\", the possible reasons and a \"come back later\" note) that replaces the whole app — sign-in included — survives normal AND hard refreshes, and cannot be bypassed. Playback data APIs answer 503 while it is on, so nobody can listen even by skipping the UI. The wall re-checks every 30 seconds and lets everyone back in the moment maintenance is switched off; music already downloaded keeps playing locally once the wall is gone.",
      },
    ],
  },
  {
    version: "1.12.1",
    date: "2026-11-02",
    title: "Honest connection errors — you're online, the upstream isn't",
    entries: [
      {
        type: "fixed",
        text: "The web app no longer claims you are offline when you are not. Liner's servers are reached from your browser directly, and when they block your network or region (Cloudflare 403s) the old code fell through to a false \"You're offline\" plus generic network-error toasts. The connectivity probe now also checks this website's own backend: if it answers but Liner's upstream does not, you get the accurate message — \"Your internet works, but Liner can't reach its servers\" — with a VPN hint, while downloaded and local music keep playing.",
      },
      {
        type: "changed",
        text: "If Liner's upstream servers are unreachable from your network or region, a VPN to another region usually restores full functionality instantly — nothing on the website needs to change.",
      },
    ],
  },
  {
    version: "1.12.0",
    date: "2026-10-31",
    title: "Core updated to Liner v0.2.11 — and your liked songs are all here",
    entries: [
      {
        type: "changed",
        text: "The whole app core was updated to upstream Liner v0.2.11 (633 files): the redesigned home/library shell with keep-alive page transitions and history navigation island, the new offline-aware router, upgraded YouTube/innertube plumbing with request timeouts, the stricter audio-format check before caching, capped in-memory caches, the improved fullscreen visuals (ambient glow, glass blur options), a complete French translation and a brand-new Bahasa Indonesia locale — every web-port feature (downloads, download-all, AI translate, equalizer, local music, moderation, changelog) was re-integrated on top and the full 1,177-test suite passes.",
      },
      {
        type: "fixed",
        text: "Liked Songs showing only part of your library: liked tracks whose snapshot the server could not hydrate came back with an empty id, and all of those blank rows shared one React key — so React collapsed them into a single row and most of your songs simply vanished from the list. The loader now skips unhydrated entries, dedupes by id, and retries a flaky page once before giving up, so all 74 (or 740) of your songs show up.",
      },
      {
        type: "fixed",
        text: "Batch downloads now retry every track once automatically when a download hiccups (rate limits, dropped connections) before marking it failed — large Download-all batches finish cleanly instead of leaving scattered red rows.",
      },
      {
        type: "fixed",
        text: "F11 in the browser fullscreens the website again (the desktop-only handling no longer swallows it on the web), and the sidebar's Settings entry is back where it was.",
      },
    ],
  },
  {
    version: "1.11.0",
    date: "2026-10-31",
    title: "Download all — a whole collection in one tap",
    entries: [
      {
        type: "added",
        text: "A \"Download all\" button now sits next to Play on Liked Songs, every playlist, album and daily mix: one tap queues the entire collection for offline. The batch drains through the fast parallel downloader (2 songs at a time, 4 range requests each), and the button itself turns into a live \"Downloading 12/45\" counter so you always know where the batch is.",
      },
      {
        type: "added",
        text: "The queue drawer got its own download-all action too: the download arrow in the queue header saves everything lined up, with the same n/m progress right on the button. Songs already downloaded are skipped — press it again any time and it only fetches what's missing — and the button flips to a green checkmark once every song in the collection is on your device.",
      },
      {
        type: "changed",
        text: "Batch downloads stay polite: playback always gets the bandwidth first, each finished song is written to pinned storage immediately (so a completed album is safe even if you close the tab mid-batch), and any song that fails shows its red state on its own row for a one-tap retry.",
      },
    ],
  },
  {
    version: "1.10.0",
    date: "2026-10-31",
    title: "Take your music anywhere — offline downloads",
    entries: [
      {
        type: "added",
        text: "Every song now has a \"Download (offline)\" action: hover a row in Liked Songs, any playlist, search results, the artist page or the queue and hit the download arrow — or pick it from the ⋮ menu. The audio is fetched with parallel range requests (the same fast chunked engine the preload cache uses), validated, and stored in your browser's IndexedDB as a pinned, never-evicted copy.",
      },
      {
        type: "added",
        text: "Downloads play even with zero network: the player already prefers locally stored audio, so a downloaded song starts instantly on a plane, on mobile data, or when the upstream source is down. Progress shows right on the row (percent while streaming), and the sidebar has a new Downloads page listing everything you've saved with sizes, one-tap play, and per-song removal.",
      },
      {
        type: "added",
        text: "The website itself now works offline: a service worker caches the app shell and hashed bundles (network-first for the shell so deploys land instantly, cache-first for immutable assets), plus your cover art. Lose connection mid-session and the interface still loads — downloaded songs keep playing.",
      },
      {
        type: "changed",
        text: "Downloads are pinned and exempt from the audio cache limit — clearing the playback cache or hitting the 3 GB LRU ceiling can no longer take away a song you explicitly saved. Removing a download frees its space immediately.",
      },
    ],
  },
  {
    version: "1.9.2",
    date: "2026-10-29",
    title: "One player, not two — lyrics behave again",
    entries: [
      {
        type: "fixed",
        text: "The fullscreen player was silently mounted TWICE whenever it was opened as a page, stacking two identical lyric panes. Turning the lyrics off collapsed the hidden copy while the visible one stayed on screen — the \"I turned lyrics off and they just won't be gone\" bug. The player is now guaranteed to exist exactly once, so the Lyrics pill always controls what you actually see.",
      },
      {
        type: "fixed",
        text: "The duplicate also duplicated the translation engine: two hooks raced over the same request and the pane you were looking at could lose the race and show nothing. With a single player, the translation you trigger is the translation that appears.",
      },
      {
        type: "fixed",
        text: "Translation errors are now visible next to the AI button (in red) instead of hiding behind a hover tooltip, and clicking the AI button retries immediately. A failed OpenRouter call now tells you why instead of doing nothing.",
      },
      {
        type: "fixed",
        text: "Google Translate picked a new last-resort fallback: if the free Google endpoint and its backup are both unreachable, translations fall through to the built-in Liner AI translator instead of failing. The Tagalog connection test passes for every provider again.",
      },
      {
        type: "fixed",
        text: "The Liner AI provider card now shows the Liner logo itself — the app's own mark — instead of a generic gradient sparkle.",
      },
      {
        type: "added",
        text: "AI translations now join the karaoke glow: the line being sung lights up its translation in the same colour and soft glow as the original lyrics, then eases back when the line ends — no more frozen dim text under a glowing lyric.",
      },
      {
        type: "fixed",
        text: "The translation glow now lands ON the beat. braccato marks a line active about half a second before it is sung (so the view can scroll to it in time), and the first glow build keyed on that flag — so translations lit up noticeably early and faded out mid-word. The glow is now driven straight from the playback clock, brightening at the exact moment the line starts and dimming exactly when the next one begins, matching the original lyrics frame for frame.",
      },
      {
        type: "fixed",
        text: "Switching songs used to leave the next song with no translation at all — toggling the AI button off and on did nothing, and the only cure was closing and reopening the fullscreen player. A slow translation for the previous song was silently blocking every new song's request. Each song now fetches on its own, finished translations are always kept, and a failure is only shown while you are still on the song that failed.",
      },
      {
        type: "added",
        text: "English songs no longer \"translate\" into English: when the lyrics are already in the language you picked, the AI button stands down (dimmed, with a hint to pick another language) and nothing is fetched. Pick a different target language — Tagalog, Japanese, anything — and the same song translates normally again, no toggle needed.",
      },
      {
        type: "changed",
        text: "The same stand-down now covers EVERY language, not just English: Tagalog lyrics picked for Tagalog — or Spanish for Spanish, Japanese for Japanese, any match — dim the AI button with a \"Lyrics are already in …\" hint and skip the pointless translation, while any other target keeps the feature fully alive. Detection runs right on the lyrics text (script check first, then grammar words), and mixed-language sheets are never guessed, so nothing needed ever gets disabled.",
      },
      {
        type: "fixed",
        text: "The translation glow now lights up exactly when the WORDS are sung, not when the lyric line is stamped. Word-synced providers mark each line slightly early so the view can scroll ahead — but the glow build keyed on that stamp, so the translation brightened while the original line was still dark. The glow now starts at the first sung word's own timestamp (background choirs don't count), and keeps holding until the line hands over, exactly like the original lyrics do.",
      },
    ],
  },
  {
    version: "1.9.1",
    date: "2026-10-29",
    title: "AI Translate polish — off means off, in-sync lyrics",
    entries: [
      {
        type: "fixed",
        text: "Translations now actually appear under the lyrics. The renderer draws every karaoke line twice (a highlight copy plus the visible text), so the old text-matching injector never matched a single line — the translation was fetched, then thrown away. Lines are now matched by position, which is exact.",
      },
      {
        type: "fixed",
        text: "Turning AI Translate off now really removes the translated lines from the lyrics — before, they stayed on screen until the next song.",
      },
      {
        type: "fixed",
        text: "Lyrics stay in sync with the song after translations appear: line heights are re-measured the moment a translation lands, so autoscroll and karaoke timing no longer drift.",
      },
      {
        type: "fixed",
        text: "Switching translation language or provider swaps the lines immediately instead of keeping the old language on screen.",
      },
      {
        type: "fixed",
        text: "The connection test no longer cries \"Test failed\" for languages like Filipino — tiny phrases like \"Hello world\" are often left untranslated, so the test now uses full sentences.",
      },
      {
        type: "fixed",
        text: "OpenRouter, Gemini, OpenAI and Claude defaults moved to current models — the old default model had been retired upstream, which made OpenRouter translations fail. Failed model answers now show a clear error instead of silently doing nothing.",
      },
    ],
  },
  {
    version: "1.9",
    date: "2026-10-28",
    title: "AI Translate that actually translates",
    entries: [
      {
        type: "fixed",
        text: "AI Translate now really translates. The first version relied on Google's free endpoint, which silently refuses requests coming from web servers — so nothing ever appeared. Fixed at the root.",
      },
      {
        type: "added",
        text: "Liner AI — a built-in translator running on our own server. No API key, no setup, one request per song with natural phrasing. It is now the default and works for everyone.",
      },
      {
        type: "fixed",
        text: "Google Translate option: lyrics are now translated directly from your device instead of through our server, so the free Google option works again.",
      },
      {
        type: "changed",
        text: "Real brand logos everywhere in Settings → AI Translate: the official Google Translate and Gemini marks in full colour, plus the genuine OpenRouter, OpenAI, Claude and Ollama logos.",
      },
    ],
  },
  {
    version: "1.8",
    date: "2026-10-28",
    title: "AI lyrics translation",
    entries: [
      {
        type: "added",
        text: "AI Translate: see what a song is saying — translated lines now appear right under the original lyrics in the fullscreen player.",
      },
      {
        type: "added",
        text: "Six translators: Google Translate (free, no key needed), OpenRouter, Gemini, OpenAI, Claude and Ollama.",
      },
      {
        type: "added",
        text: "New Settings → AI Translate tab: pick a provider (with logos), target language, API keys, custom models, auto-translate and a connection test.",
      },
      {
        type: "added",
        text: "\"AI\" pill button in the lyrics pane to toggle the translation for the current song.",
      },
      {
        type: "added",
        text: "Translations are cached per song + language, so replaying a track never costs tokens again.",
      },
      {
        type: "added",
        text: "Changelog: this sidebar button. Every website update now lists what was added or fixed.",
      },
      {
        type: "fixed",
        text: "Local Music sidebar button hardened — it now navigates even if a stale overlay or cached page swallows the click. If the button ever felt dead for you, one hard refresh (Ctrl+Shift+R) puts you on the latest version for good.",
      },
    ],
  },
  {
    version: "1.7",
    date: "2026-10-28",
    title: "Deploy reliability overhaul",
    entries: [
      {
        type: "fixed",
        text: "Website updates no longer get stuck on \"Deploying…\" — the build no longer packages broken symlinked modules that crashed the server on boot.",
      },
      {
        type: "fixed",
        text: "Deploy packages slimmed from 157 MB to well under 100 MB by removing 31 generations of stale cached files (127 MB → 4.3 MB of app assets).",
      },
      {
        type: "changed",
        text: "Faster page loads: the app now always ships only the current build's files.",
      },
    ],
  },
  {
    version: "1.6",
    date: "2026-10-27",
    title: "Local Music rebuilt",
    entries: [
      {
        type: "added",
        text: "Local Music page: scan folders, drag & drop audio files, filter and sort your offline library.",
      },
      {
        type: "added",
        text: "Local tracks play straight from your browser storage — fully offline, with embedded cover art.",
      },
      {
        type: "fixed",
        text: "Scan failures now show a clear toast instead of failing silently.",
      },
    ],
  },
  {
    version: "1.5",
    date: "2026-10-26",
    title: "Sound wave visualizer",
    entries: [
      {
        type: "added",
        text: "Optional live sound wave in the fullscreen player, driven by the real audio graph (Settings → Playback to enable).",
      },
      {
        type: "fixed",
        text: "Visualizer stays perfectly in sync with play/pause and seeks.",
      },
    ],
  },
  {
    version: "1.4",
    date: "2026-10-25",
    title: "Website tools",
    entries: [
      {
        type: "added",
        text: "Announcement system: the site owner can broadcast messages to everyone.",
      },
      {
        type: "added",
        text: "User Finder: look up any account on the site (admin).",
      },
      {
        type: "added",
        text: "Moderation tools: ban/unban accounts and IPs (admin).",
      },
    ],
  },
  {
    version: "1.3",
    date: "2026-10-24",
    title: "Player polish",
    entries: [
      {
        type: "added",
        text: "Fullscreen player lyrics pane with word-level animations, romaji support and per-provider lyrics picker.",
      },
      {
        type: "added",
        text: "Lyrics offset control (±0.1s) persisted per track.",
      },
      {
        type: "changed",
        text: "Lyrics visibility now remembered between sessions, like the desktop app.",
      },
    ],
  },
];
