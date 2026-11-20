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
import type { TranslateConfig } from "./translate";

// In-flight translation requests, keyed by cache key (track::provider::lang).
// Module scope, NOT component state: the fullscreen lyrics view remounts on
// every track change (AnimatePresence key), and a fetch started by the old
// instance must still be visible to the new one — otherwise the same song's
// translation is fetched twice across the remount (and a prefetch plus a
// foreground open would double-fire too).
const inflightTranslations = new Map<string, Promise<void>>();

// Silent retry policy for background prefetches: a transient LLM failure
// used to mean the song never got its translation — the prefetch effect's
// dependencies don't change after a failure, so nothing ever re-ran. Two
// patient retries per track (then give up until the user re-triggers).
const RETRY_DELAYS_MS = [3_000, 10_000];
const failureCounts = new Map<string, number>();

/** @internal test hook — clears the silent-retry bookkeeping */
export function resetRetryStateForTests(): void {
  failureCounts.clear();
}

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

  const cached = store.cache[cacheKey];
  if (cached) {
    // the entry is aligned against the lyric set that was live when it was
    // fetched — a provider switch mid-song yields a different line count and
    // makes the entry stale. Without this check the stale entry blocked every
    // refetch forever (the button claimed the translation was showing while
    // the lyrics rendered none of it).
    if (cached.lines.length === sourceLines.length) {
      if (reportErrors) store.setLastError(null);
      return;
    }
    store.clearCacheEntry(cacheKey);
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
    // pendingKey tracks EVERY in-flight fetch — background prefetches too.
    // The button must show "Loading translation…" while the prefetch runs,
    // not claim the translation is already showing (pendingKey is per cache
    // key, so the button can tell which track it is actually waiting on).
    // Only lastError stays foreground-gated: a background failure must not
    // flash UI for a view the user hasn't opened.
    const current = useAiTranslateStore.getState();
    current.setPendingKey(cacheKey);
    if (reportErrors) current.setLastError(null);
    try {
      const translated = await translateLines(sourceLines, config);
      const after = useAiTranslateStore.getState();
      // cache unconditionally: pendingKey may have moved on to a newer
      // track's fetch, and dropping the result here used to throw away
      // finished work — going back to this song paid for it again
      after.cacheTranslation(cacheKey, translated);
      failureCounts.delete(cacheKey);
      if (after.pendingKey === cacheKey) after.setPendingKey(null);
    } catch (error) {
      const after = useAiTranslateStore.getState();
      const stillCurrent = after.pendingKey === cacheKey;
      if (stillCurrent) after.setPendingKey(null);
      // surface the error only while THIS track is still the one being
      // waited on and the fetch ran in the foreground — a stale or
      // background failure must not light the button red uninvited
      if (reportErrors && stillCurrent) {
        const message =
          error instanceof TranslationError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        after.setLastError(message);
      }
      // background failures retry silently a bounded number of times;
      // foreground failures keep the visible "click to retry" contract
      // instead of auto-re-firing while the user is looking at the error
      if (!reportErrors) {
        const failures = failureCounts.get(cacheKey) ?? 0;
        if (failures < RETRY_DELAYS_MS.length) {
          failureCounts.set(cacheKey, failures + 1);
          setTimeout(() => {
            ensureTranslation(trackId, sourceLines, config, options);
          }, RETRY_DELAYS_MS[failures]);
        } else {
          failureCounts.delete(cacheKey);
        }
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
 * Gated by the same switches as the in-view flow (feature enabled,
 * auto-translate or a manual request for this track) so prefetch never
 * does work the user asked the feature not to do. Same-language pairs
 * (EN→EN) go through like any other target: the user's explicit choice
 * always translates.
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
    const sourceLines = lyrics.map((line) => String(line?.words ?? ""));
    if (sourceLines.every((line) => !line.trim())) return;
    ensureTranslation(
      trackId,
      sourceLines,
      getConfigFromState(useAiTranslateStore.getState()),
    );
  }, [enabled, autoTranslate, manualTracks, trackId, lyrics, provider, targetLang, cache]);
}
