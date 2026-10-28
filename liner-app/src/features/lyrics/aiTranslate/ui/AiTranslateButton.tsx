// Lyrics-pane pill button: turns AI translation on/off for the current song.
// Sits next to the lyrics provider island in the fullscreen player.

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Translate2AiLine } from "@mingcute/react";
import {
  useAiTranslateStore,
  translationCacheKey,
} from "../aiTranslateStore";
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
  const trackId = useLyricsStore((s) => s.currentLyricsTrackId);

  const [hintOpen, setHintOpen] = useState(false);

  const waitingForThisTrack = Boolean(
    enabled &&
      !autoTranslate &&
      trackId &&
      !cache[translationCacheKey(trackId, provider, targetLang)],
  );

  const busy = Boolean(enabled && pendingKey);
  const hasCache = Object.keys(cache).length > 0;
  const def = getProviderDef(provider);

  // tooltip copy mirrors the desktop app's translate status
  let hint = `AI Translate: ${def.label} → ${targetLang.toUpperCase()}`;
  if (enabled && lastError) hint = lastError;
  else if (busy) hint = "Translating lyrics…";
  else if (waitingForThisTrack)
    hint = "Tap to translate this song";
  else if (enabled && hasCache) hint = `Showing ${def.label} translation`;

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
          if (store.enabled) {
            store.setEnabled(false);
          } else {
            store.setEnabled(true);
            // manual mode: this press is the per-song trigger
            if (trackId) store.requestManualTranslation(trackId);
          }
        }}
        aria-pressed={enabled}
        title={hint}
        className={`h-[32px] min-h-[32px] max-h-[32px] box-border inline-flex items-center gap-[6px] px-[10px] rounded-lg text-[12px] font-[500] border-none cursor-pointer transition-all active:scale-[0.97] ${
          isActive
            ? "bg-white/90 text-black hover:bg-white"
            : "bg-black/50 backdrop-blur-xl text-white/80 hover:text-white hover:bg-black/70"
        }`}
        style={{ fontFamily: "var(--font-inter), sans-serif" }}
      >
        <Translate2AiLine
          size={15}
          className={busy ? "animate-pulse" : ""}
        />
        <span>AI</span>
      </button>

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
