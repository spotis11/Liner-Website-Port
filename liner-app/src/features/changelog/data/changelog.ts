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
