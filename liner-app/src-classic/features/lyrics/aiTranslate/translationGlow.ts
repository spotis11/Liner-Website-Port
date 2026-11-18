// Drives the injected AI translation glow from the MEDIA CLOCK.
//
// Why not CSS keyed on `.blyrics--active`: braccato adds that class EARLY —
// 0.54s of scroll lead (EARLY_SCROLL_CONSIDER, "blyrics-early-scroll-consider-s")
// plus a learned animation-clock offset on top — so in practice the class
// lands >1s before the line is sung, while the original words' highlight
// overlays are driven by the media clock and start exactly at each word's
// time. A fixed transition delay tuned against one song was still half a
// second early on the next ("the AI translation is so early / not in sync").
//
// The only clock that is always right is the one braccato itself follows:
// the `#liner-audio` element (the custom element's `source` is bound to
// "#liner-audio" in FullscreenPlayer) — the same reading the word sweep
// uses. So this driver owns an `ai-tr--glow` class on every injected
// translation, toggled per animation frame against media time:
//
//   on  from the line's first sung word (the earliest timed part — the
//       line's own timestamp regularly LEADS the vocal, so keying on it
//       glowed the translation while the original words were still dark:
//       the "original is in song sync, the AI translation isn't" report)
//   off from the line's end          (durationMs, else the next line's start —
//       the engine keeps sung words lit until the line exits, so the line end
//       — never the last word's end — is the faithful off beat)
//
// aiTranslateGlow.css animates both edges (0.33s in / 0.5s out — braccato's
// own highlight fade-in/fade-out durations) with no delays: the class flips
// on the beat, the CSS just eases.
//
// The class is display-state only, recomputed every frame — braccato can
// rebuild lines or translations can be re-injected underneath us at any time
// and the next frame re-applies whatever is correct.

import type { Lyric, LyricPart } from "@braccato/parsers";

const GLOW_CLASS = "ai-tr--glow";

/**
 * The moment the line's original words actually light up.
 *
 * braccato highlights WORDS, not lines: every timed part gets its own
 * animations whose clock starts at that part's startTimeMs (engine.js
 * startWordAnimations), and a line's own timestamp often leads the vocal —
 * providers stamp line starts early so autoscroll lands first. Keying the
 * translation on the line start therefore lit it while the original words
 * were still dark — the "original is in song sync, the AI translation
 * isn't" report. Line-synced sheets have no real parts (braccato
 * fabricates one per token starting at the line start), so there the line
 * start is correct.
 *
 * Background vocals are excluded: they sing at their own times and would
 * pull the translation's window away from the lead vocal the user follows.
 *
 * No end edge here on purpose: the engine keeps a line's sung words LIT
 * (fill: forwards) until the line exits and only then fades them out, so
 * the translation must hold to the line's own end too — see buildPairs.
 */
function firstSungWordS(lyric: Lyric): number {
  const parts = (lyric.parts ?? []).filter(
    (part: LyricPart) =>
      !part.isBackground &&
      typeof part.startTimeMs === "number" &&
      typeof part.words === "string" &&
      part.words.trim().length > 0,
  );
  // Timed parts ARE the engine's light-up times — they win over the line's
  // own stamp even when the line leads the vocal (providers stamp lines
  // early on purpose so autoscroll lands first). Only part-less sheets
  // (plain line-synced) light at the line start.
  if (parts.length > 0) {
    return Math.max(0, Math.min(...parts.map((part) => part.startTimeMs)) / 1000);
  }
  return Math.max(0, (lyric.startTimeMs ?? 0) / 1000);
}

export interface TranslationGlowController {
  stop: () => void;
}

/** Reads the media clock braccato follows (#liner-audio). Null when absent. */
export function mediaTimeS(): number | null {
  const audio = document.getElementById(
    "liner-audio",
  ) as HTMLAudioElement | null;
  if (!audio) return null;
  const t = audio.currentTime;
  return Number.isFinite(t) ? t : null;
}

/**
 * Starts the per-frame glow driver for one lyrics element.
 * `getLyrics` must return the same Lyric[] the lines were built from (the
 * store's braccatoLyrics — offset-adjusted, index-aligned with
 * data-line-number). Returns a stop() that cancels the loop.
 */
export function startTranslationGlow(
  element: HTMLElement,
  getLyrics: () => Lyric[] | null | undefined,
  getTime: () => number | null = mediaTimeS,
): TranslationGlowController {
  let stopped = false;
  let rafId = 0;

  interface GlowPair {
    tr: HTMLElement;
    startS: number;
    endS: number;
  }
  let pairs: GlowPair[] | null = null;
  // Set by the MutationObserver whenever braccato touches the subtree —
  // lines rebuilt, translations injected or stripped, same node counts or
  // not. The next frame rebuilds the pair cache. Count heuristics alone
  // missed same-shape changes (an injection burst keeps .blyrics--line
  // counts identical), so the observer is the source of truth.
  let dirty = true;

  const buildPairs = () => {
    const lyrics = getLyrics() ?? [];
    const lines = element.querySelectorAll<HTMLElement>(".blyrics--line");
    const next: GlowPair[] = [];
    lines.forEach((line) => {
      const tr = line.querySelector<HTMLElement>(".blyrics--translated");
      if (!tr) return;
      const idx = Number(line.dataset.lineNumber);
      const lyric = Number.isInteger(idx) ? lyrics[idx] : undefined;
      if (!lyric) return;
      const startS = firstSungWordS(lyric);
      // Hold the glow while the line is the one being sung: the provider's
      // duration when it ships one (anchored at the LINE start — the line
      // end, not the word end), otherwise up to the next line's start. The
      // last line holds its glow to the end — the engine keeps its own
      // last-line highlight up the same way. The sung WORDS decide when the
      // glow STARTS (a line start that leads the vocal must not light the
      // translation early); the LINE decides when it ends, exactly like the
      // engine, which keeps the sung words lit until the line exits.
      let endS = Infinity;
      if ((lyric.durationMs ?? 0) > 0) {
        endS = Math.max(0, (lyric.startTimeMs ?? 0) / 1000) + lyric.durationMs / 1000;
      } else {
        for (let j = idx + 1; j < lyrics.length; j++) {
          const later = (lyrics[j]?.startTimeMs ?? 0) / 1000;
          if (later > startS) {
            endS = later;
            break;
          }
        }
      }
      next.push({ tr, startS, endS });
    });
    pairs = next;
  };

  const tick = () => {
    if (stopped) return;
    rafId = requestAnimationFrame(tick);
    const t = getTime();
    if (t === null) return;

    // Rebuild the pair cache when braccato changed the subtree (observer)
    // or the lyric array was replaced.
    if (dirty || !pairs) {
      dirty = false;
      buildPairs();
    }
    const current = pairs ?? [];
    for (const { tr, startS, endS } of current) {
      const shouldGlow = t >= startS && t < endS;
      // classList.toggle no-ops when the state is unchanged, so holding on
      // the right value costs nothing per frame.
      tr.classList.toggle(GLOW_CLASS, shouldGlow);
    }
  };

  const observer = new MutationObserver(() => {
    dirty = true;
  });
  observer.observe(element, { childList: true, subtree: true });

  rafId = requestAnimationFrame(tick);

  return {
    stop: () => {
      stopped = true;
      observer.disconnect();
      cancelAnimationFrame(rafId);
    },
  };
}
