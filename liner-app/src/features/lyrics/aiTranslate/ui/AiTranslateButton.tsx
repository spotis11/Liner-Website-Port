// Lyrics-pane pill button: turns AI translation on/off for the current song.
// Sits next to the lyrics provider island in the fullscreen player.

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Translate2AiLine } from "@mingcute/react";
import { useAiTranslateStore, translationCacheKey } from "../aiTranslateStore";
import { getProviderDef } from "../providers";
import { useLyricsStore } from "../../store/lyricsStore";

export function AiTranslateButton() {
  const enabled = useAiTranslateStore((s) => s.enabled);
  const autoTranslate = useAiTranslateStore((s) => s.autoTranslate);
  const pendingKey = useAiTranslateStore((s) => s.pendingKey);
  const lastError = useAiTranslateStore((s) => s.lastError);
  const provider = useAiTranslateStore((s) => s.provider);
  const targetLang = useAiTranslateStore((s) => s.targetLang);
  const cache = useAiTranslateStore((s) => s.cache);
  const manualTracks = useAiTranslateStore((s) => s.manualTracks);
  const trackId = useLyricsStore((s) => s.currentLyricsTrackId);
  const lyrics = useLyricsStore((s) => s.braccatoLyrics);

  const [hintOpen, setHintOpen] = useState(false);

  // Per-track state, not per-store: "Showing … translation" must only ever
  // appear once THIS song's translation is actually in the cache, and the
  // loading state must show while THIS song's fetch (foreground OR the
  // root prefetcher) is in flight.
  const trackKey = trackId
    ? translationCacheKey(trackId, provider, targetLang)
    : null;
  const cachedForTrack = trackKey ? cache[trackKey] : undefined;
  const hasCurrentTranslation = Boolean(
    cachedForTrack && cachedForTrack.lines.length === lyrics.length,
  );
  const loadingThisTrack = Boolean(
    enabled && trackKey && pendingKey === trackKey && !hasCurrentTranslation,
  );
  const waitingForThisTrack = Boolean(
    enabled &&
      !autoTranslate &&
      trackId &&
      !hasCurrentTranslation &&
      !manualTracks[trackId],
  );

  const busy = Boolean(enabled && pendingKey);
  const def = getProviderDef(provider);

  // tooltip copy mirrors the desktop app's translate status
  let hint = `AI Translate: ${def.label} → ${targetLang.toUpperCase()}`;
  if (enabled && lastError) hint = lastError;
  else if (loadingThisTrack) hint = "Loading translation…";
  else if (enabled && hasCurrentTranslation)
    hint = `Showing ${def.label} translation`;
  else if (waitingForThisTrack) hint = "Tap to translate this song";

  const isActive = enabled && !lastError;

  return (
    <div
      className="relative inline-flex pointer-events-auto select-none"
      onMouseEnter={() => setHintOpen(true)}
      onMouseLeave={() => setHintOpen(false)}
    >
      <button
        type="button"
        onClick={() => {
          const store = useAiTranslateStore.getState();
          // an errored translation must not swallow the press: the obvious
          // user move is "click it again" — retry, don't silently turn off
          if (store.enabled && store.lastError) {
            store.retry();
            if (trackId && !store.autoTranslate) {
              store.requestManualTranslation(trackId);
            }
            return;
          }
          if (store.enabled) {
            store.setEnabled(false);
          } else {
            store.setEnabled(true);
            // manual mode: this press is the per-song trigger
            if (trackId) store.requestManualTranslation(trackId);
          }
        }}
        aria-pressed={enabled}
        aria-busy={loadingThisTrack || undefined}
        title={hint}
        className={`h-[32px] min-h-[32px] max-h-[32px] box-border inline-flex items-center gap-[6px] px-[10px] rounded-lg text-[12px] font-[500] border-none cursor-pointer transition-all active:scale-[0.97] ${
          isActive
            ? "bg-white/90 text-black hover:bg-white"
            : lastError && enabled
              ? "bg-[#e05545]/90 text-white hover:bg-[#e05545]"
              : "bg-black/50 backdrop-blur-xl text-white/80 hover:text-white hover:bg-black/70"
        }`}
        style={{ fontFamily: "var(--font-inter), sans-serif" }}
      >
        <Translate2AiLine
          size={15}
          className={loadingThisTrack ? "animate-pulse" : ""}
        />
        {/* the load must be visible ON the button, not only in the tooltip —
            while the fetch (prefetch or foreground) is in flight the pill
            says so, and only a finished translation says "AI" again */}
        <span className="whitespace-nowrap">
          {loadingThisTrack ? "Loading translation…" : "AI"}
        </span>
      </button>

      {/* the error must be VISIBLE, not hidden behind a hover tooltip — the
          "translation didn't work" reports were this error going unseen */}
      {enabled && lastError && (
        <p
          className="absolute right-0 top-full mt-[6px] m-0 max-w-[260px] rounded-lg border border-[#e05545]/40 bg-black/85 backdrop-blur-xl px-[10px] py-[6px] text-[11.5px] leading-[1.35] text-[#ffb4ab] whitespace-normal z-50 pointer-events-none"
          title={lastError}
        >
          {lastError}
          <span className="block text-[10.5px] text-white/60 mt-[2px]">
            Click the AI button to retry
          </span>
        </p>
      )}

      <AnimatePresence>
        {hintOpen && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full right-0 mb-[8px] max-w-[240px] rounded-lg border border-white/10 bg-black/85 backdrop-blur-xl px-[10px] py-[7px] text-[11.5px] leading-[1.35] text-white/90 z-50 pointer-events-none whitespace-normal"
          >
            {hint}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
