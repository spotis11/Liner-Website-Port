// AI Translate settings + per-track translation cache.
//
// Persisted: provider, target language, API keys (localStorage — this is a
// client-side web app, the same place the desktop app keeps them), model
// overrides, Ollama URL and a bounded cache of finished translations so
// reopening a song never re-pays for tokens.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { debouncedStorage } from "@/shared/utils/storage";
import type { AiProviderId } from "./providers";
import { getProviderDef } from "./providers";

export const AI_TRANSLATE_STORAGE_KEY = "liner_ai_translate_v1";

export interface CachedTranslation {
  lines: string[];
  at: number;
}

const CACHE_MAX_TRACKS = 40;

interface AiTranslateState {
  enabled: boolean;
  /** auto-translate every song as soon as lyrics load */
  autoTranslate: boolean;
  provider: AiProviderId;
  targetLang: string;
  apiKeys: Partial<Record<AiProviderId, string>>;
  models: Partial<Record<AiProviderId, string>>;
  ollamaUrl: string;
  cache: Record<string, CachedTranslation>;
  /** tracks the user explicitly asked to translate (when auto is off) */
  manualTracks: Record<string, true>;
  /** transient — which cache key is being fetched right now */
  pendingKey: string | null;
  /** transient — last error message for the lyrics pane */
  lastError: string | null;
  /** bumped by an explicit retry so the fetch effect re-runs on demand */
  retryToken: number;

  setEnabled: (enabled: boolean) => void;
  setAutoTranslate: (auto: boolean) => void;
  requestManualTranslation: (trackId: string) => void;
  setProvider: (provider: AiProviderId) => void;
  setTargetLang: (lang: string) => void;
  setApiKey: (provider: AiProviderId, key: string) => void;
  setModel: (provider: AiProviderId, model: string) => void;
  setOllamaUrl: (url: string) => void;
  cacheTranslation: (cacheKey: string, lines: string[]) => void;
  /** drop one stale entry (e.g. aligned against a different lyric set) */
  clearCacheEntry: (cacheKey: string) => void;
  setPendingKey: (key: string | null) => void;
  setLastError: (error: string | null) => void;
  /** clear the error and re-run the translation for the current track */
  retry: () => void;
  clearCache: () => void;
}

export function translationCacheKey(
  trackId: string,
  provider: AiProviderId,
  targetLang: string,
): string {
  return `${trackId}::${provider}::${targetLang}`;
}

export function resolveModel(
  provider: AiProviderId,
  models: Partial<Record<AiProviderId, string>>,
): string {
  const custom = (models[provider] ?? "").trim();
  return custom || getProviderDef(provider).defaultModel;
}

export const useAiTranslateStore = create<AiTranslateState>()(
  persist(
    (set) => ({
      enabled: false,
      autoTranslate: true,
      provider: "liner",
      targetLang: "en",
      apiKeys: {},
      models: {},
      ollamaUrl: "http://localhost:11434",
      cache: {},
      manualTracks: {},
      pendingKey: null,
      lastError: null,
      retryToken: 0,

      setEnabled: (enabled) => set({ enabled, lastError: null }),
      setAutoTranslate: (autoTranslate) => set({ autoTranslate }),
      requestManualTranslation: (trackId) =>
        set((state) => ({
          manualTracks: { ...state.manualTracks, [trackId]: true },
          lastError: null,
        })),
      setProvider: (provider) => set({ provider, lastError: null }),
      setTargetLang: (targetLang) => set({ targetLang, lastError: null }),
      setApiKey: (provider, key) =>
        set((state) => ({
          apiKeys: { ...state.apiKeys, [provider]: key },
          lastError: null,
        })),
      setModel: (provider, model) =>
        set((state) => ({ models: { ...state.models, [provider]: model } })),
      setOllamaUrl: (ollamaUrl) => set({ ollamaUrl }),
      cacheTranslation: (cacheKey, lines) =>
        set((state) => {
          const next = { ...state.cache, [cacheKey]: { lines, at: Date.now() } };
          // bound the cache: drop the oldest entries past the cap
          const keys = Object.keys(next);
          if (keys.length > CACHE_MAX_TRACKS) {
            keys
              .sort((a, b) => (next[a]?.at ?? 0) - (next[b]?.at ?? 0))
              .slice(0, keys.length - CACHE_MAX_TRACKS)
              .forEach((k) => delete next[k]);
          }
          return { cache: next };
        }),
      clearCacheEntry: (cacheKey) =>
        set((state) => {
          if (!(cacheKey in state.cache)) return {};
          const next = { ...state.cache };
          delete next[cacheKey];
          return { cache: next };
        }),
      setPendingKey: (pendingKey) => set({ pendingKey }),
      setLastError: (lastError) => set({ lastError }),
      retry: () =>
        set((state) => ({
          retryToken: state.retryToken + 1,
          lastError: null,
        })),
      clearCache: () => set({ cache: {} }),
    }),
    {
      name: AI_TRANSLATE_STORAGE_KEY,
      storage: createJSONStorage(() => debouncedStorage),
      partialize: (state) => ({
        enabled: state.enabled,
        autoTranslate: state.autoTranslate,
        provider: state.provider,
        targetLang: state.targetLang,
        apiKeys: state.apiKeys,
        models: state.models,
        ollamaUrl: state.ollamaUrl,
        cache: state.cache,
        manualTracks: state.manualTracks,
      }),
    },
  ),
);

export function getConfigFromState(state: AiTranslateState) {
  return {
    provider: state.provider,
    targetLang: state.targetLang,
    apiKey: state.apiKeys[state.provider],
    model: resolveModel(state.provider, state.models),
    ollamaUrl: state.ollamaUrl,
  };
}
