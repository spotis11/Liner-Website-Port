// Shared "make sure this track has a translation" engine.
//
// Extracted from useLyricsAiTranslation so the SAME flow can run from two
// places:
//  - the fullscreen lyrics hook (foreground: drives pendingKey + lastError),
//  - a root-level prefetcher that fires the moment lyrics arrive for the
//    playing track — long before the user opens the fullscreen view. The
//    2–5 s Liner AI round-trip then happens while the song is still
//    starting, and opening the lyrics finds the translation already in the
//    persisted cache: instant.
//
// All deduping lives here: the persisted store cache first, then the
// module-level inflight map (which must survive the fullscreen view
// remounting on every track change — see the map's comment below).

import { useEffect } from "react";
import { useLyricsStore } from "../store/lyricsStore";
import {
  useAiTranslateStore,
  translationCacheKey,
  getConfigFromState,
} from "./aiTranslateStore";
import { translateLines, providerIsReady, TranslationError } from "./translate";
import { isNoopTranslation } from "./lyricsLanguage";
import type { TranslateConfig } from "./translate";

// In-flight translation requests, keyed by cache key (track::provider::lang).
// Module scope, NOT component state: the fullscreen lyrics view remounts on
// every track change (AnimatePresence key), and a fetch started by the old
// instance must still be visible to the new one — otherwise the same song's
// translation is fetched twice across the remount (and a prefetch plus a
// foreground open would double-fire too).
const inflightTranslations = new Map<string, Promise<void>>();

export interface EnsureTranslationOptions {
  /**
   * Foreground calls (the user is looking at the lyrics pane) surface
   * provider problems: a missing key lights the button, errors show in the
   * pane. Background prefetches stay silent — a failure must not flash UI
   * for a view the user hasn't opened; if it failed quietly the pane simply
   * refetches in the foreground when opened.
   */
  reportErrors?: boolean;
}

export function ensureTranslation(
  trackId: string,
  sourceLines: string[],
  config: TranslateConfig,
  options: EnsureTranslationOptions = {},
): void {
  const reportErrors = options.reportErrors ?? false;
  const store = useAiTranslateStore.getState();
  const cacheKey = translationCacheKey(
    trackId,
    config.provider,
    config.targetLang,
  );

  if (store.cache[cacheKey]) {
    if (reportErrors) store.setLastError(null);
    return;
  }
  if (inflightTranslations.has(cacheKey)) return;
  if (!providerIsReady(config.provider, config)) {
    if (reportErrors) {
      store.setLastError(
        `${config.provider === "ollama" ? "Ollama" : "API key missing"} — open Settings → AI Translate.`,
      );
    }
    return;
  }
  if (sourceLines.every((line) => !line.trim())) return;

  const run = async () => {
    const current = useAiTranslateStore.getState();
    // presentation state for the CURRENT track — overwriting a slower
    // fetch's key is the point, not a race to defend against
    if (reportErrors) {
      current.setPendingKey(cacheKey);
      current.setLastError(null);
    }
    try {
      const translated = await translateLines(sourceLines, config);
      const after = useAiTranslateStore.getState();
      // cache unconditionally: pendingKey may have moved on to a newer
      // track's fetch, and dropping the result here used to throw away
      // finished work — going back to this song paid for it again
      after.cacheTranslation(cacheKey, translated);
      if (after.pendingKey === cacheKey) after.setPendingKey(null);
    } catch (error) {
      const after = useAiTranslateStore.getState();
      // surface the error only while THIS track is still the one being
      // waited on — a stale failure must not light the button red on a
      // song the user has already left
      if (reportErrors && after.pendingKey === cacheKey) {
        const message =
          error instanceof TranslationError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        after.setLastError(message);
        after.setPendingKey(null);
      }
    } finally {
      inflightTranslations.delete(cacheKey);
    }
  };
  inflightTranslations.set(cacheKey, run());
}

/**
 * Root-level prefetcher: watches the lyrics store and starts the
 * translation for the playing track the second its lyrics land — the
 * fullscreen view does not need to be open. Mounted once from App.tsx.
 * Gated by the exact same switches as the in-view flow (feature enabled,
 * auto-translate or a manual request for this track, lyrics not already in
 * the target language) so prefetch never does work the user asked the
 * feature not to do.
 */
export function useAiTranslatePrefetch(): void {
  const trackId = useLyricsStore((s) => s.currentLyricsTrackId);
  const lyrics = useLyricsStore((s) => s.braccatoLyrics);
  const enabled = useAiTranslateStore((s) => s.enabled);
  const autoTranslate = useAiTranslateStore((s) => s.autoTranslate);
  const manualTracks = useAiTranslateStore((s) => s.manualTracks);
  // subscribed so settings changes re-run the prefetch like the in-view flow
  const provider = useAiTranslateStore((s) => s.provider);
  const targetLang = useAiTranslateStore((s) => s.targetLang);
  const cache = useAiTranslateStore((s) => s.cache);

  useEffect(() => {
    if (!enabled || !trackId) return;
    if (!autoTranslate && !manualTracks[trackId]) return;
    if (isNoopTranslation(lyrics, targetLang)) return;
    const sourceLines = lyrics.map((line) => String(line?.words ?? ""));
    if (sourceLines.every((line) => !line.trim())) return;
    ensureTranslation(
      trackId,
      sourceLines,
      getConfigFromState(useAiTranslateStore.getState()),
    );
  }, [enabled, autoTranslate, manualTracks, trackId, lyrics, provider, targetLang, cache]);
}
