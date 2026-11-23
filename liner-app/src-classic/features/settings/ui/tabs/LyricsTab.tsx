import { useState } from "react";
import { MusicNote } from "@solar-icons/react";
import { Slider, ToggleSwitch } from "@classic/shared/ui";
import { useTranslation } from "@classic/languages";
import { SettingRow, SettingSection } from "../controls";
import { previewCssFor, LyricsStyleBrowser } from "./LyricsStyleBrowser";
import {
  LYRIC_GLOW_MAX,
  LYRIC_GLOW_MIN,
  LYRIC_SIZE_MAX_PCT,
  LYRIC_SIZE_MIN_PCT,
  getLyricStyle,
} from "@classic/features/lyrics/styles/lyricStyles";
import { useLyricsStyleStore } from "@classic/features/lyrics/store/lyricsStyleStore";

/**
 * Settings → Lyrics: lyric style gallery, custom color, glow and size for
 * the canvas lyrics renderer. Mirrors the desktop app's "Lyrics & pop-up"
 * tab (its pop-up section is desktop-only and has no web equivalent).
 */
export function LyricsTab({ searchQuery }: { searchQuery: string }) {
  const { t } = useTranslation();
  const [browserOpen, setBrowserOpen] = useState(false);
  const styleId = useLyricsStyleStore((s) => s.styleId);
  const customColorEnabled = useLyricsStyleStore((s) => s.customColorEnabled);
  const customColor = useLyricsStyleStore((s) => s.customColor);
  const glowEnabled = useLyricsStyleStore((s) => s.glowEnabled);
  const glowStrength = useLyricsStyleStore((s) => s.glowStrength);
  const sizePct = useLyricsStyleStore((s) => s.sizePct);
  const {
    setStyleId,
    setCustomColorEnabled,
    setCustomColor,
    setGlowEnabled,
    setGlowStrength,
    setSizePct,
  } = useLyricsStyleStore.getState();
  const style = getLyricStyle(styleId);

  return (
    <>
      <SettingSection label={t("settings.lyrics.section") || "Lyrics across Liner"}>
        <SettingRow
          title={t("settings.lyrics.style") || "Lyric style"}
          description={
            t("settings.lyrics.style_desc") ||
            "Pick how the words light up in the full-screen lyrics."
          }
          searchQuery={searchQuery}
          control={
            <button
              type="button"
              onClick={() => setBrowserOpen(true)}
              className="flex cursor-pointer items-center gap-[10px] rounded-[12px] border border-border-alpha-14 bg-fill/60 px-[10px] py-[6px] transition-colors hover:bg-fill"
            >
              <span
                aria-hidden
                className="flex h-[30px] min-w-[64px] items-center justify-center rounded-[8px] bg-black/80 px-[8px] text-[10px] text-white/90"
              >
                <LyricPreviewSnippet styleId={style.id} />
              </span>
              <span className="flex flex-col items-start">
                <span className="text-[13px] font-[500] text-text-primary">
                  {style.name}
                </span>
                <span className="text-[11px] text-text-tertiary">
                  {t("settings.lyrics.browse_styles") || "Browse styles"}
                </span>
              </span>
              <MusicNote size={15} className="text-text-tertiary" />
            </button>
          }
        />
        <SettingRow
          title={t("settings.lyrics.custom_color") || "Use custom lyric color"}
          description={
            t("settings.lyrics.custom_color_desc") ||
            "Override the style's color with your own."
          }
          searchQuery={searchQuery}
          control={
            <ToggleSwitch
              checked={customColorEnabled}
              onChange={setCustomColorEnabled}
              ariaLabel={t("settings.lyrics.custom_color") || "Use custom lyric color"}
            />
          }
        />
        <SettingRow
          title={t("settings.lyrics.lyric_color") || "Lyric color"}
          searchQuery={searchQuery}
          control={
            <label
              className={`relative inline-flex h-[26px] w-[44px] cursor-pointer items-center justify-center rounded-full border border-white/25 transition-opacity ${
                customColorEnabled ? "" : "pointer-events-none opacity-40"
              }`}
              style={{ background: customColor }}
            >
              <input
                type="color"
                value={customColor}
                onChange={(e) => {
                  setCustomColor(e.target.value);
                  setCustomColorEnabled(true);
                }}
                aria-label={t("settings.lyrics.lyric_color") || "Lyric color"}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
          }
        />
        <SettingRow
          title={t("settings.lyrics.glow") || "Lyric glow"}
          description={
            t("settings.lyrics.glow_desc") ||
            "Halo behind the words as they light up."
          }
          searchQuery={searchQuery}
          control={
            <ToggleSwitch
              checked={glowEnabled}
              onChange={setGlowEnabled}
              ariaLabel={t("settings.lyrics.glow") || "Lyric glow"}
            />
          }
        />
        <SettingRow
          title={t("settings.lyrics.glow_strength") || "Glow strength"}
          searchQuery={searchQuery}
          control={
            <div className="w-[190px] shrink-0">
              <Slider
                value={glowStrength}
                onChange={setGlowStrength}
                min={LYRIC_GLOW_MIN}
                max={LYRIC_GLOW_MAX}
                step={0.1}
                formatValue={(value) => `×${value.toFixed(1)}`}
                ariaLabel={t("settings.lyrics.glow_strength") || "Glow strength"}
                disabled={!glowEnabled}
              />
            </div>
          }
        />
        <SettingRow
          title={t("settings.lyrics.size") || "Lyric size"}
          searchQuery={searchQuery}
          control={
            <div className="w-[190px] shrink-0">
              <Slider
                value={sizePct}
                onChange={setSizePct}
                min={LYRIC_SIZE_MIN_PCT}
                max={LYRIC_SIZE_MAX_PCT}
                step={5}
                unit="%"
                ariaLabel={t("settings.lyrics.size") || "Lyric size"}
              />
            </div>
          }
        />
      </SettingSection>

      {browserOpen && (
        <LyricsStyleBrowser
          onClose={() => setBrowserOpen(false)}
          onSelect={(id) => setStyleId(id)}
        />
      )}
    </>
  );
}

/** tiny preview text inside the style row pill, styled like the theme */
function LyricPreviewSnippet({ styleId }: { styleId: string }) {
  const style = getLyricStyle(styleId);
  return (
    <span style={previewCssFor(style)}>
      in the style
    </span>
  );
}
