import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  DEFAULT_LYRIC_STYLE_ID,
  LYRIC_GLOW_MAX,
  LYRIC_GLOW_MIN,
  LYRIC_SIZE_MAX_PCT,
  LYRIC_SIZE_MIN_PCT,
  getLyricStyle,
  resolveLyricsTypography,
  type LyricStylePrefs,
} from "../styles/lyricStyles";
import type { LyricsTypography } from "../canvas/types";

export interface LyricsStyleState extends LyricStylePrefs {
  styleId: string;
  setStyleId: (id: string) => void;
  setCustomColorEnabled: (enabled: boolean) => void;
  setCustomColor: (color: string) => void;
  setGlowEnabled: (enabled: boolean) => void;
  setGlowStrength: (strength: number) => void;
  setSizePct: (pct: number) => void;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/**
 * Settings → Lyrics preferences, persisted to localStorage. Feeds the canvas
 * lyrics renderer through useLyricsStyleTypography().
 */
export const useLyricsStyleStore = create<LyricsStyleState>()(
  persist(
    (set) => ({
      styleId: DEFAULT_LYRIC_STYLE_ID,
      sizePct: 100,
      customColorEnabled: false,
      customColor: "#ffffff",
      glowEnabled: true,
      glowStrength: 1,
      setStyleId: (id) => set({ styleId: getLyricStyle(id).id }),
      setCustomColorEnabled: (enabled) =>
        set({ customColorEnabled: enabled }),
      setCustomColor: (color) => set({ customColor: color }),
      setGlowEnabled: (enabled) => set({ glowEnabled: enabled }),
      setGlowStrength: (strength) =>
        set({
          glowStrength: clamp(
            strength,
            LYRIC_GLOW_MIN,
            LYRIC_GLOW_MAX,
          ),
        }),
      setSizePct: (pct) =>
        set({ sizePct: clamp(pct, LYRIC_SIZE_MIN_PCT, LYRIC_SIZE_MAX_PCT) }),
    }),
    {
      name: "liner_lyrics_style_v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        styleId: state.styleId,
        sizePct: state.sizePct,
        customColorEnabled: state.customColorEnabled,
        customColor: state.customColor,
        glowEnabled: state.glowEnabled,
        glowStrength: state.glowStrength,
      }),
    },
  ),
);

/**
 * Resolved renderer typography from the current style + prefs. Empty family
 * means "keep the scene's host-resolved family" — LyricsScene.setTypography
 * merges it.
 */
export function useLyricsStyleTypography(): LyricsTypography {
  const styleId = useLyricsStyleStore((s) => s.styleId);
  const sizePct = useLyricsStyleStore((s) => s.sizePct);
  const customColorEnabled = useLyricsStyleStore((s) => s.customColorEnabled);
  const customColor = useLyricsStyleStore((s) => s.customColor);
  const glowEnabled = useLyricsStyleStore((s) => s.glowEnabled);
  const glowStrength = useLyricsStyleStore((s) => s.glowStrength);
  return resolveLyricsTypography(getLyricStyle(styleId), {
    sizePct,
    customColorEnabled,
    customColor,
    glowEnabled,
    glowStrength,
  });
}
