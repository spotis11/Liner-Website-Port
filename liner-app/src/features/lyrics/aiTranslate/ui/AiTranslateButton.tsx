// Lyrics-pane pill button: turns AI translation on/off for the current song.
// Sits next to the lyrics provider island in the fullscreen player.

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Translate2AiLine } from "@mingcute/react";
import { useAiTranslateStore } from "../aiTranslateStore";
import { getProviderDef } from "../providers";
import {
  detectLyricsLanguage,
  isNoopTranslation,
  languageLabel,
} from "../lyricsLanguage";
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
  const lyrics = useLyricsStore((s) => s.braccatoLyrics);

  const [hintOpen, setHintOpen] = useState(false);

  // Lyrics already IN the target language would "translate" Tagalog into
  // Tagalog, English into English, Japanese into Japanese — the feature
  // stands down for that song (the hook strips and skips too, so this
  // visual is not a lie). Any other target translates the same song
  // normally, so the flag must NOT disable the button there.
  const detectedLang = useMemo(() => detectLyricsLanguage(lyrics), [lyrics]);
  const noopForThisSong = useMemo(
    () => isNoopTranslation(lyrics, targetLang),
    [lyrics, targetLang],
  );

  const waitingForThisTrack = Boolean(
    enabled && !autoTranslate && trackId && !cache[`${trackId}::${provider}::${targetLang}`],
  );

  const busy = Boolean(enabled && pendingKey);
  const hasCache = Object.keys(cache).length > 0;
  const def = getProviderDef(provider);

  // tooltip copy mirrors the desktop app's translate status
  let hint = `AI Translate: ${def.label} → ${targetLang.toUpperCase()}`;
  if (enabled && noopForThisSong)
    hint = `Lyrics are already in ${languageLabel(detectedLang ?? "")} — choose another language to translate`;
  else if (enabled && lastError) hint = lastError;
  else if (busy) hint = "Translating lyrics…";
  else if (waitingForThisTrack)
    hint = "Tap to translate this song";
  else if (enabled && hasCache) hint = `Showing ${def.label} translation`;

  const isActive = enabled && !lastError && !noopForThisSong;

  return (
    <div
      className="relative inline-flex pointer-events-auto select-none"
      onMouseEnter={() => setHintOpen(true)}
      onMouseLeave={() => setHintOpen(false)}
    >
      <button
        type="button"
        onClick={() => {
          // Same-language stands down for this song (Tagalog → Tagalog,
          // English → English, …); a press must not flip the global toggle
          // while the button says "disabled"
          if (enabled && noopForThisSong) return;
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
        aria-disabled={enabled && noopForThisSong ? true : undefined}
        title={hint}
        className={`h-[32px] min-h-[32px] max-h-[32px] box-border inline-flex items-center gap-[6px] px-[10px] rounded-lg text-[12px] font-[500] border-none cursor-pointer transition-all active:scale-[0.97] ${
          isActive
            ? "bg-white/90 text-black hover:bg-white"
            : lastError && enabled
              ? "bg-[#e05545]/90 text-white hover:bg-[#e05545]"
              : enabled && noopForThisSong
                ? "bg-black/40 text-white/35 cursor-default"
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
