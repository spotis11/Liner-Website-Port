// Bridges translations into the braccato lyrics DOM.
//
// braccato builds one `.blyrics--line` per Lyric. Its public `injectTranslation`
// appends a `.blyrics--translated` line UNDER the main line — exactly how the
// desktop app shows "what the song is saying" beneath the original lyrics.
//
// Flow: lyrics load → hook ensures a translation for the current track
// (cache → provider) → walks rendered lines and injects by LINE INDEX
// (braccato's data-line-number) — text matching never worked because the
// karaoke layout renders each line's text twice. A MutationObserver
// re-applies injections when braccato rebuilds lines (track change,
// provider switch, offset change).
//
// Two rules the first version missed:
//  - Turning the feature OFF (or switching language/provider) must REMOVE the
//    injected lines, not just stop adding new ones. `stripTranslatedLines`
//    handles that.
//  - Changing line heights invalidates the engine's scroll measurements, so
//    autoscroll drifts out of sync with the audio. braccato exposes exactly
//    the right door for this — `renderer.scheduleLyricPositionUpdate`, built
//    for "one call per streamed translation and romanization" — which
//    re-measures every line + decoration and re-ticks against the playback
//    clock. `remeasureLyrics` MUST run after every injection/strip burst.

import { useCallback, useEffect, useMemo, useRef } from "react";
import { injectTranslation } from "@braccato/core";
import { useLyricsStore } from "../store/lyricsStore";
import {
  useAiTranslateStore,
  translationCacheKey,
  getConfigFromState,
} from "./aiTranslateStore";
import { translateLines, TranslationError, providerIsReady } from "./translate";
import { startTranslationGlow } from "./translationGlow";
import { isNoopTranslation } from "./lyricsLanguage";
import type { AiProviderId } from "./providers";

// In-flight translation requests, keyed by cache key (track::provider::lang).
// Module scope, NOT component state: the fullscreen lyrics view remounts on
// every track change (AnimatePresence key), and a fetch started by the old
// instance must still be visible to the new one — otherwise the same song's
// translation is fetched twice across the remount.
const inflightTranslations = new Map<string, Promise<void>>();

export type TranslationStatus =
  | "idle"
  | "missing-key"
  | "pending"
  | "ready"
  | "error";

interface InjectionState {
  generation: number;
}

interface BraccatoElement extends HTMLElement {
  renderer?: {
    scheduleLyricPositionUpdate?: (
      isTicking: () => boolean,
      retick: () => void,
    ) => void;
    retickFromPlaybackClock?: (buildOptions: (eventCreationTime: unknown, playState: boolean) => unknown) => unknown;
  };
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Removes every injected translation line from the lyrics view. */
function stripTranslatedLines(element: HTMLElement): number {
  const nodes = element.querySelectorAll<HTMLElement>(".blyrics--translated");
  nodes.forEach((node) => node.remove());
  return nodes.length;
}

/**
 * Tells braccato the layout changed: re-measures all line positions, heights
 * and decorators (relayout) and re-renders against the last playback clock
 * reading. Without this, the taller translated lines leave the engine
 * scrolling to stale positions — the "lyrics not syncing" report.
 */
function remeasureLyrics(element: HTMLElement): void {
  const renderer = (element as BraccatoElement).renderer;
  const schedule = renderer?.scheduleLyricPositionUpdate;
  if (typeof schedule !== "function") return;
  try {
    schedule(
      () => true,
      () => {
        const retick = renderer?.retickFromPlaybackClock;
        if (typeof retick !== "function") return;
        try {
          retick((_eventCreationTime, playState) => ({ isPlaying: playState }));
        } catch {
          /* retick is best-effort — the next frame tick re-renders anyway */
        }
      },
    );
  } catch {
    /* re-measure is best-effort; relayout also happens on resize */
  }
}

export function useLyricsAiTranslation(
  getElement: () => HTMLElement | null,
): { status: TranslationStatus; toggle: () => void; active: boolean; busy: boolean } {
  const lyrics = useLyricsStore((s) => s.braccatoLyrics);
  const trackId = useLyricsStore((s) => s.currentLyricsTrackId);
  const enabled = useAiTranslateStore((s) => s.enabled);
  const autoTranslate = useAiTranslateStore((s) => s.autoTranslate);
  const manualTracks = useAiTranslateStore((s) => s.manualTracks);
  const pendingKey = useAiTranslateStore((s) => s.pendingKey);
  const lastError = useAiTranslateStore((s) => s.lastError);
  // subscribe to these so a settings change re-runs the effects below —
  // otherwise switching language/provider (or a translation finishing while
  // the player is open) never re-triggered anything until the next track
  const provider = useAiTranslateStore((s) => s.provider);
  const targetLang = useAiTranslateStore((s) => s.targetLang);
  const cache = useAiTranslateStore((s) => s.cache);
  const retryToken = useAiTranslateStore((s) => s.retryToken);
  const injectionRef = useRef<InjectionState>({ generation: 0 });
  /** which cache key the lines currently in the DOM belong to */
  const injectedKeyRef = useRef<string | null>(null);
  /** which track the injectedKeyRef was recorded for */
  const injectedTrackRef = useRef<string | null>(null);

  // Lyrics already in the TARGET language are a no-op (English → English,
  // Tagalog → Tagalog, …): stand down for this song (and strip whatever is
  // on screen) without touching the user's enabled flag — picking another
  // target brings the feature straight back for the same song. See
  // lyricsLanguage.ts for the detection.
  const noopTranslation = useMemo(
    () => isNoopTranslation(lyrics, targetLang),
    [lyrics, targetLang],
  );

  const wantsTranslation =
    enabled &&
    Boolean(trackId) &&
    !noopTranslation &&
    (autoTranslate || Boolean(trackId && manualTracks[trackId]));
  const active = Boolean(enabled && trackId && !noopTranslation);
  const status: TranslationStatus = !enabled
    ? "idle"
    : pendingKey
      ? "pending"
      : lastError
        ? "error"
        : (() => {
            const state = useAiTranslateStore.getState();
            if (!trackId) return "idle";
            const key = translationCacheKey(
              trackId,
              state.provider,
              state.targetLang,
            );
            return state.cache[key] ? "ready" : state.lastError ? "error" : "idle";
          })();

  const toggle = useCallback(() => {
    const store = useAiTranslateStore.getState();
    store.setEnabled(!store.enabled);
  }, []);

  // ---- 1. ensure translation exists for the current track ----
  // One pendingKey for the whole store used to make a slow fetch for the
  // PREVIOUS track block every new track: the guard "another fetch won —
  // leave it alone" bailed out, and when the old fetch finally resolved
  // nothing re-triggered the new track's fetch (the store's pendingKey isn't
  // a dependency). The user saw a song with no translation that neither
  // toggling nor waiting fixed — only closing and reopening the fullscreen
  // player, which remounted this hook. Now every cache key fetches on its
  // own: a slow/hung fetch for track A never blocks track B.
  useEffect(() => {
    if (!wantsTranslation || !trackId) return;
    const store = useAiTranslateStore.getState();
    const config = getConfigFromState(store);
    const cacheKey = translationCacheKey(trackId, config.provider, config.targetLang);

    if (store.cache[cacheKey]) {
      store.setLastError(null);
      return;
    }
    if (inflightTranslations.has(cacheKey)) return;
    if (!providerIsReady(config.provider, config)) {
      store.setLastError(
        `${config.provider === "ollama" ? "Ollama" : "API key missing"} — open Settings → AI Translate.`,
      );
      return;
    }

    const sourceLines = lyrics.map((line) => String(line?.words ?? ""));
    if (sourceLines.every((line) => !line.trim())) return;

    const run = async () => {
      const current = useAiTranslateStore.getState();
      // presentation state for the CURRENT track — overwriting a slower
      // fetch's key is the point, not a race to defend against
      current.setPendingKey(cacheKey);
      current.setLastError(null);
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
        if (after.pendingKey === cacheKey) {
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
  }, [wantsTranslation, trackId, lyrics, provider, targetLang, retryToken]);

  // ---- 2. inject translated lines under each rendered line ----
  const applyInjections = useCallback(() => {
    const element = getElement();
    const state = useAiTranslateStore.getState();
    if (!element || !state.enabled) return;
    // no-op translations (English → English) never inject; the strip effect
    // owns removing whatever is already on screen
    if (isNoopTranslation(useLyricsStore.getState().braccatoLyrics, state.targetLang))
      return;

    const currentTrackId = useLyricsStore.getState().currentLyricsTrackId;
    if (!currentTrackId) return;
    const cacheKey = translationCacheKey(
      currentTrackId,
      state.provider,
      state.targetLang,
    );
    const cached = state.cache[cacheKey];
    if (!cached) return;

    // new track → braccato rebuilt the lines; forget what was injected before
    if (injectedTrackRef.current !== currentTrackId) {
      injectedTrackRef.current = currentTrackId;
      injectedKeyRef.current = null;
    }

    // language/provider switch: the lines in the DOM belong to the OLD
    // cache key — strip them so the switch (or a pending re-fetch) is
    // visible immediately instead of showing the previous language forever
    if (
      injectedKeyRef.current &&
      injectedKeyRef.current !== cacheKey &&
      element.querySelector(".blyrics--translated")
    ) {
      stripTranslatedLines(element);
      injectedKeyRef.current = null;
      remeasureLyrics(element);
    }

    const lyricsNow = useLyricsStore.getState().braccatoLyrics;
    const translations = cached.lines;

    // The cached array was aligned against the lyric set that was live when
    // it was fetched. If the lyrics provider changed since (different line
    // count), the cache is stale for this view — drop it so the fetch effect
    // re-translates against the current lines instead of putting translated
    // text under the wrong lines.
    if (translations.length !== lyricsNow.length) {
      useAiTranslateStore.getState().clearCacheEntry(cacheKey);
      return;
    }

    // Inject by INDEX, not by text. braccato stamps every rendered line with
    // data-line-number = its position in the lyrics array it was built from,
    // which is exactly the array the translations are aligned against. The
    // first version matched on the line's textContent — but the karaoke
    // layout renders each line TWICE inside .blyrics-line-main (a highlight
    // copy plus the visible run), so the DOM text never equalled the lyric
    // text and NOTHING was ever injected, even though the translation
    // request had succeeded. Index mapping is exact and duplicate-safe.
    const lang = state.targetLang;
    const lineElements = element.querySelectorAll<HTMLElement>(".blyrics--line");
    let injected = 0;

    lineElements.forEach((lineElement) => {
      if (lineElement.querySelector(".blyrics--translated")) return;
      const index = Number(lineElement.dataset.lineNumber);
      if (!Number.isInteger(index) || index < 0 || index >= lyricsNow.length) return;
      const translated = translations[index];
      if (typeof translated !== "string" || !translated.trim()) return;
      // skip lines whose "translation" is identical to the source — the
      // engine's own repeatsLine guard can't see this either (it reads the
      // duplicated karaoke text), so guard here against double-rendered lines
      const source = String(lyricsNow[index]?.words ?? "");
      if (source.trim() && normalizeText(source) === normalizeText(translated)) return;
      injectTranslation(document, lineElement, translated.trim(), lang);
      injected += 1;
    });

    if (injected > 0) {
      injectedKeyRef.current = cacheKey;
      injectionRef.current.generation += 1;
      // heights changed — re-measure so autoscroll and karaoke stay in sync
      remeasureLyrics(element);
    }
  }, [getElement]);

  // ---- 3. turning the feature off removes the translations ----
  useEffect(() => {
    if (wantsTranslation) return;
    const element = getElement();
    if (!element) return;
    injectedKeyRef.current = null;
    injectedTrackRef.current = null;
    const removed = stripTranslatedLines(element);
    if (removed > 0) remeasureLyrics(element);
  }, [wantsTranslation, getElement]);

  // re-apply whenever lyrics/track/settings change AND whenever braccato
  // rebuilds its lines (observed below) — injection is idempotent. The cache
  // object is a dep so a translation that finishes while the player is open
  // (or a language switch that re-fetches) lands on screen right away.
  useEffect(() => {
    if (!wantsTranslation) return;
    const raf = requestAnimationFrame(() => applyInjections());
    return () => cancelAnimationFrame(raf);
  }, [wantsTranslation, lyrics, trackId, applyInjections, provider, targetLang, cache]);

  useEffect(() => {
    if (!wantsTranslation) return;
    const element = getElement();
    if (!element) return;

    const observer = new MutationObserver(() => {
      // braccato rebuilds lines asynchronously; micro-delay keeps us off the
      // critical frame and collapses bursts into one pass
      const gen = injectionRef.current.generation;
      setTimeout(() => {
        if (injectionRef.current.generation === gen) {
          applyInjections();
        }
      }, 120);
    });
    observer.observe(element, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [wantsTranslation, getElement, applyInjections, trackId]);

  // ---- 4. glow the active translation in sync with the singing ----
  // Keyed on the media clock (see translationGlow.ts): .blyrics--active is
  // added early for autoscroll, so CSS keyed on it glowed ~0.5s+ ahead of
  // the vocal. The driver toggles a class per frame against #liner-audio —
  // the same reading braccato's word sweep uses — so the translation
  // brightens exactly when its line starts and dims when it ends.
  useEffect(() => {
    if (!wantsTranslation) return;
    const element = getElement();
    if (!element) return;
    const glow = startTranslationGlow(element, () =>
      useLyricsStore.getState().braccatoLyrics,
    );
    return () => glow.stop();
  }, [wantsTranslation, getElement, trackId]);

  return { status, toggle, active, busy: Boolean(wantsTranslation && pendingKey) };
}

export type { AiProviderId };
