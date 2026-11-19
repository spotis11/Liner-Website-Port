import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { useTranslation, LOCALE_OPTIONS } from "@classic/languages";
import {
  MenuSelect,
  ToggleSwitch,
  useToast,
  Dialog,
  DialogActions,
  DialogButton,
} from "@classic/shared/ui";
import { revealThemeChange } from "@classic/shared/lib";
import logo from "@classic/assets/logo.svg";
import { SettingBlock, SettingRow, SettingSection } from "../controls";
import {
  COLOR_THEMES,
  useAppearanceStore,
  selectIsColorThemeActive,
  type UiStyle,
} from "../../store/appearanceStore";
import { themeSwatchGradient } from "../../store/colorThemes";
import { useCustomizationStore } from "../../store/customizationStore";
import { useLiquidGlassStore } from "@classic/features/liquid-glass";
import { ColorThemeCard } from "./ColorThemeCard";

export function AppearanceTab({ searchQuery }: { searchQuery?: string }) {
  const { t, locale, setLocale } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { toast } = useToast();

  const colorThemeId = useAppearanceStore((s) => s.colorThemeId);
  const sameAsDevice = useAppearanceStore((s) => s.sameAsDevice);
  const setColorTheme = useAppearanceStore((s) => s.setColorTheme);
  const setSameAsDevice = useAppearanceStore((s) => s.setSameAsDevice);
  const colorThemeActive = useAppearanceStore(selectIsColorThemeActive);
  const uiStyle = useAppearanceStore((s) => s.uiStyle);
  const setUiStyle = useAppearanceStore((s) => s.setUiStyle);
  // Liner-styled prompt after the login design changes: the switch saves
  // instantly but the sign-in page only re-renders on a fresh load, so Okay
  // performs the hard refresh (the session survives — it lives in storage).
  const [refreshPromptOpen, setRefreshPromptOpen] = useState(false);

  const wallpaperImage = useCustomizationStore((s) => s.backgroundImage);
  const clearWallpaper = useCustomizationStore((s) => s.setBackgroundImage);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSameAsDevice = (value: boolean) => {
    setSameAsDevice(value);
    if (value) {
      setTheme("system");
    } else {
      setTheme(resolvedTheme === "light" ? "light" : "dark");
    }
  };

  const handleColorSwatch = (
    event: React.MouseEvent<HTMLButtonElement>,
    themeId: string,
  ) => {
    // Re-click on the active theme deselects it and returns to the base look.
    if (colorThemeId === themeId) {
      setColorTheme(null);
      return;
    }
    // Interlock: wallpapers are not allowed while a color theme is applied.
    if (wallpaperImage) {
      clearWallpaper(null);
      toast(
        t("settings.appearance.wallpaper_removed_for_theme") ||
          "Wallpaper removed — themes and wallpapers can't be combined.",
        "info",
      );
    }
    revealThemeChange(() => setColorTheme(themeId), {
      x: event.clientX,
      y: event.clientY,
    });
  };

  const handleBaseSwatch = (
    event: React.MouseEvent<HTMLButtonElement>,
    mode: "light" | "dark",
  ) => {
    setColorTheme(null);
    setSameAsDevice(false);
    revealThemeChange(() => setTheme(mode), {
      x: event.clientX,
      y: event.clientY,
    });
  };

  return (
    <SettingSection>
      <SettingRow
        title={t("settings.language.label")}
        description={t("settings.language.description")}
        titleKey="settings.language.label"
        descKey="settings.language.description"
        searchQuery={searchQuery}
        control={
          mounted ? (
            <MenuSelect
              options={LOCALE_OPTIONS}
              value={locale}
              onChange={setLocale}
              className="min-w-[130px]"
              aria-label={t("settings.language.label")}
            />
          ) : (
            <span />
          )
        }
      />

      <SettingRow
        title={t("settings.appearance.ui_style_title") || "UI"}
        description={
          t("settings.appearance.ui_style_description") ||
          "Pick the Liner design. Original is the classic look; New is the full redesign — it applies to the whole app after a refresh."
        }
        titleKey="settings.appearance.ui_style_title"
        descKey="settings.appearance.ui_style_description"
        searchQuery={searchQuery}
        control={
          <div
            className="flex flex-wrap items-start gap-[10px]"
            role="radiogroup"
            aria-label={t("settings.appearance.ui_style_title") || "UI"}
          >
            {(
              [
                {
                  value: "original" as UiStyle,
                  preview: "ui-preview-original.jpg",
                  label:
                    t("settings.appearance.ui_style_original") ||
                    "Original (default)",
                },
                {
                  value: "new" as UiStyle,
                  preview: "ui-preview-new.jpg",
                  label: t("settings.appearance.ui_style_new") || "New",
                },
                {
                  value: "material3" as UiStyle,
                  preview: "ui-preview-material3.jpg",
                  label: "MATERIAL 3",
                },
              ] as const
            ).map((option) => {
              const selected = uiStyle === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  title={option.label}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (uiStyle === option.value) return;
                    setUiStyle(option.value);
                    setRefreshPromptOpen(true);
                  }}
                  className={`group relative m-0 flex cursor-pointer flex-col items-center gap-[6px] rounded-[10px] border bg-transparent p-[6px] transition-colors ${
                    selected
                      ? "border-white/70"
                      : "border-transparent hover:border-white/25"
                  }`}
                >
                  <span className="relative block overflow-hidden rounded-[7px] shadow-[0_2px_10px_rgba(0,0,0,0.35)]">
                    <img
                      src={`${import.meta.env.BASE_URL}${option.preview}`}
                      alt={option.label}
                      width={132}
                      height={82}
                      loading="lazy"
                      draggable={false}
                      className="block h-[82px] w-[132px] object-cover"
                    />
                    {selected && (
                      <span className="absolute right-[5px] top-[5px] flex h-[16px] w-[16px] items-center justify-center rounded-full bg-white text-black shadow">
                        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
                          <path
                            d="M3.5 8.5l3 3 6-6.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    )}
                  </span>
                  <span
                    className={`max-w-[132px] truncate text-[11.5px] font-[600] leading-none ${
                      selected
                        ? "text-text-primary"
                        : "text-text-secondary group-hover:text-text-primary"
                    }`}
                  >
                    {option.label}
                  </span>
                </button>
              );
            })}
          </div>
        }
      />

      <SettingRow
        title={t("settings.appearance.same_as_device_title") || "Same as device theme"}
        description={
          t("settings.appearance.same_as_device_description") ||
          "Match the device light or dark setting."
        }
        titleKey="settings.appearance.same_as_device_title"
        descKey="settings.appearance.same_as_device_description"
        searchQuery={searchQuery}
        control={
          <ToggleSwitch
            checked={sameAsDevice}
            onChange={handleSameAsDevice}
            ariaLabel={t("settings.appearance.same_as_device_title") || "Same as device theme"}
          />
        }
      />

      <SettingBlock
        title={t("settings.appearance.color_themes_title") || "Color themes"}
        description={
          t("settings.appearance.color_themes_description") ||
          "Choose a theme color. Light and Black are included."
        }
        titleKey="settings.appearance.color_themes_title"
        descKey="settings.appearance.color_themes_description"
        searchQuery={searchQuery}
      >
        <div className="grid grid-cols-4 gap-[10px] sm:grid-cols-6 md:grid-cols-8">
          {COLOR_THEMES.map((def) => {
            const isBase = def.id === "light" || def.id === "black";
            const active = isBase
              ? !colorThemeActive &&
                (def.id === "light"
                  ? resolvedTheme === "light"
                  : resolvedTheme === "dark" || theme === "dark")
              : colorThemeId === def.id;

            return (
              <ColorThemeCard
                key={def.id}
                name={def.name}
                swatch={themeSwatchGradient(def)}
                active={active}
                onSelect={(event) =>
                  isBase
                    ? handleBaseSwatch(
                        event,
                        def.id === "light" ? "light" : "dark",
                      )
                    : handleColorSwatch(event, def.id)
                }
              />
            );
          })}
        </div>
      </SettingBlock>

      <SettingRow
        title={t("settings.cover_glow.title") || "Cover glow"}
        description={
          wallpaperImage
            ? t("settings.cover_glow.disabled_for_wallpaper") ||
              "Off while a custom wallpaper is set."
            : t("settings.cover_glow.description") ||
              "Blurred artwork glow behind pages. Turn off to keep a plain background."
        }
        titleKey="settings.cover_glow.title"
        descKey={wallpaperImage ? undefined : "settings.cover_glow.description"}
        searchQuery={searchQuery}
        control={
          <CoverGlowToggle />
        }
      />

      <SettingRow
        title={t("settings.appearance.liquid_glass_title") || "Liquid glass"}
        description={
          t("settings.appearance.liquid_glass_description") ||
          "Real refracting glass on the player bar and queue drawer."
        }
        titleKey="settings.appearance.liquid_glass_title"
        descKey="settings.appearance.liquid_glass_description"
        searchQuery={searchQuery}
        control={<LiquidGlassToggle />}
      />

      <Dialog
        open={refreshPromptOpen}
        onOpenChange={setRefreshPromptOpen}
        maxWidth={360}
        // above the settings modal (z-200) so the prompt is visible while the
        // Appearance tab is open
        zIndex={210}
      >
        <div className="flex flex-col gap-[14px] px-[20px] pb-[20px] pt-[20px]">
          <div className="flex items-center gap-[10px]">
            <img
              src={logo}
              alt="Liner"
              width={45}
              height={35}
              draggable={false}
              className="theme-logo h-[20px] w-auto object-contain"
            />
            <span className="text-[15px] font-[700] tracking-[-0.02em] text-text-primary">
              Liner
            </span>
          </div>
          <p className="m-0 text-[14px] leading-[1.55] text-text-primary">
            {t("settings.appearance.ui_style_refresh_body") ||
              "Please refresh your page to apply changes."}
          </p>
          <DialogActions>
            <DialogButton
              variant="secondary"
              className="!border-0 !bg-white !text-black hover:!bg-white/90 dark:!bg-white dark:!text-black"
              onClick={() => {
                setRefreshPromptOpen(false);
                window.location.reload();
              }}
            >
              {t("settings.appearance.ui_style_refresh_okay") || "Okay"}
            </DialogButton>
          </DialogActions>
        </div>
      </Dialog>
    </SettingSection>
  );
}

function CoverGlowToggle() {
  const coverGlow = useCustomizationStore((s) => s.coverGlow);
  const setCoverGlow = useCustomizationStore((s) => s.setCoverGlow);
  const wallpaperImage = useCustomizationStore((s) => s.backgroundImage);
  const { t } = useTranslation();

  return (
    <ToggleSwitch
      checked={coverGlow && !wallpaperImage}
      onChange={setCoverGlow}
      disabled={Boolean(wallpaperImage)}
      ariaLabel={t("settings.cover_glow.title") || "Cover glow"}
    />
  );
}

function LiquidGlassToggle() {
  const enabled = useLiquidGlassStore((s) => s.enabled);
  const setEnabled = useLiquidGlassStore((s) => s.setEnabled);
  const { t } = useTranslation();

  return (
    <ToggleSwitch
      checked={enabled}
      onChange={setEnabled}
      ariaLabel={t("settings.appearance.liquid_glass_title") || "Liquid glass"}
    />
  );
}
