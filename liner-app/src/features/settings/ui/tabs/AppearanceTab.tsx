import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { useTranslation, LOCALE_OPTIONS } from "@/languages";
import { MenuSelect, ToggleSwitch, useToast } from "@/shared/ui";
import { revealThemeChange } from "@/shared/lib";
import { SettingBlock, SettingRow, SettingSection } from "../controls";
import {
  COLOR_THEMES,
  useAppearanceStore,
  selectIsColorThemeActive,
} from "../../store/appearanceStore";
import { themeSwatchGradient } from "../../store/colorThemes";
import { useCustomizationStore } from "../../store/customizationStore";
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
