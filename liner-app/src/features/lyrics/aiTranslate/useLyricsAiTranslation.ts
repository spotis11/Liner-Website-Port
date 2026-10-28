// Bridges translations into the braccato lyrics DOM.
//
// braccato builds one `.blyrics--line` per Lyric. Its public `injectTranslation`
// appends a `.blyrics--translated` line UNDER the main line — exactly how the
// desktop app shows "what the song is saying" beneath the original lyrics.
// The engine re-measures injected decorators on its own, so autoscroll stays
// correct after injection.
//
// Flow: lyrics load → hook ensures a translation for the current track
// (cache → provider) → walks rendered lines and injects by text match.
// A MutationObserver re-applies injections when braccato rebuilds lines
// (track change, provider switch, offset change).

import { useCallback, useEffect, useRef } from "react";
import { injectTranslation } from "@braccato/core";
import { useLyricsStore } from "../store/lyricsStore";
import {
  useAiTranslateStore,
  translationCacheKey,
  getConfigFromState,
} from "./aiTranslateStore";
import { translateLines, TranslationError, providerIsReady } from "./translate";
import type { AiProviderId } from "./providers";

export type TranslationStatus =
  | "idle"
  | "missing-key"
  | "pending"
  | "ready"
  | "error";

interface InjectionState {
  generation: number;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
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
  const injectionRef = useRef<InjectionState>({ generation: 0 });

  const wantsTranslation =
    enabled && Boolean(trackId) && (autoTranslate || Boolean(trackId && manualTracks[trackId]));
  const active = Boolean(enabled && trackId);
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
  useEffect(() => {
    if (!wantsTranslation || !trackId) return;
    const store = useAiTranslateStore.getState();
    const config = getConfigFromState(store);
    const cacheKey = translationCacheKey(trackId, config.provider, config.targetLang);

    if (store.cache[cacheKey]) {
      store.setLastError(null);
      return;
    }
    if (!providerIsReady(config.provider, config)) {
      store.setLastError(
        `${config.provider === "ollama" ? "Ollama" : "API key missing"} — open Settings → AI Translate.`,
      );
      return;
    }
    if (store.pendingKey === cacheKey) return;

    const sourceLines = lyrics.map((line) => String(line?.words ?? ""));
    if (sourceLines.every((line) => !line.trim())) return;

    const run = async () => {
      const current = useAiTranslateStore.getState();
      // another fetch (different key) won: leave it alone
      if (current.pendingKey && current.pendingKey !== cacheKey) return;
      current.setPendingKey(cacheKey);
      current.setLastError(null);
      try {
        const translated = await translateLines(sourceLines, config);
        const after = useAiTranslateStore.getState();
        if (after.pendingKey === cacheKey) {
          after.cacheTranslation(cacheKey, translated);
          after.setPendingKey(null);
        }
      } catch (error) {
        const after = useAiTranslateStore.getState();
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
      }
    };
    void run();
  }, [wantsTranslation, trackId, lyrics]);

  // ---- 2. inject translated lines under each rendered line ----
  const applyInjections = useCallback(() => {
    const element = getElement();
    const state = useAiTranslateStore.getState();
    if (!element || !state.enabled) return;

    const currentTrackId = useLyricsStore.getState().currentLyricsTrackId;
    if (!currentTrackId) return;
    const cacheKey = translationCacheKey(
      currentTrackId,
      state.provider,
      state.targetLang,
    );
    const cached = state.cache[cacheKey];
    if (!cached) return;

    const lyricsNow = useLyricsStore.getState().braccatoLyrics;
    const translations = cached.lines;

    // map: normalized source text → queue of translations (duplicates safe)
    const byText = new Map<string, string[]>();
    lyricsNow.forEach((line, index) => {
      const text = normalizeText(String(line?.words ?? ""));
      if (!text) return;
      const translated = translations[index];
      if (typeof translated !== "string" || !translated.trim()) return;
      const queue = byText.get(text);
      if (queue) queue.push(translated);
      else byText.set(text, [translated]);
    });

    const lang = state.targetLang;
    const lineElements = element.querySelectorAll<HTMLElement>(".blyrics--line");
    const consumed = new Map<string, number>();
    let injected = 0;

    lineElements.forEach((lineElement) => {
      if (lineElement.querySelector(".blyrics--translated")) return;
      const mainText =
        lineElement.querySelector(".blyrics-line-main")?.textContent ??
        lineElement.textContent ??
        "";
      const normalized = normalizeText(mainText);
      if (!normalized) return;
      const queue = byText.get(normalized);
      if (!queue || queue.length === 0) return;
      // count how many identical lines we already translated this pass
      const seen = consumed.get(normalized) ?? 0;
      if (seen >= queue.length) return;
      consumed.set(normalized, seen + 1);
      injectTranslation(document, lineElement, queue[seen], lang);
      injected += 1;
    });

    if (injected > 0) {
      injectionRef.current.generation += 1;
    }
  }, [getElement]);

  // re-apply whenever lyrics/track/settings change AND whenever braccato
  // rebuilds its lines (observed below) — injection is idempotent
  useEffect(() => {
    if (!wantsTranslation) return;
    const raf = requestAnimationFrame(() => applyInjections());
    return () => cancelAnimationFrame(raf);
  }, [wantsTranslation, lyrics, trackId, applyInjections]);

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

  return { status, toggle, active, busy: Boolean(wantsTranslation && pendingKey) };
}

export type { AiProviderId };
