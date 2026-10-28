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
    version: "2.0",
    date: "2026-10-28",
    title: "Translations you can actually see",
    entries: [
      {
        type: "fixed",
        text: "AI Translate lines were fetched but never shown. A lyrics-renderer update (word-level highlighting with hidden screen-reader copies of every line) broke the line matching, so translated lines silently never appeared under the original lyrics. Matching is now done directly against the lyric list — immune to any rendering quirk — and translations pop in the moment they are ready.",
      },
      {
        type: "changed",
        text: "Liner AI now wears the Liner logo itself — the same mark you see on the login screen and sidebar — instead of a placeholder tile.",
      },
      {
        type: "fixed",
        text: "Old cached \"translations\" from the broken build are retired, so nothing stale can keep a song untranslated.",
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
