import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { useTranslation, LOCALE_OPTIONS } from "@/languages";
import {
  MenuSelect,
  ToggleSwitch,
  useToast,
  Dialog,
  DialogActions,
  DialogButton,
} from "@/shared/ui";
import { revealThemeChange } from "@/shared/lib";
import logo from "@/assets/logo.svg";
import { SettingBlock, SettingRow, SettingSection } from "../controls";
import {
  COLOR_THEMES,
  useAppearanceStore,
  selectIsColorThemeActive,
  type LoginUiVariant,
} from "../../store/appearanceStore";
import { themeSwatchGradient } from "../../store/colorThemes";
import { useCustomizationStore } from "../../store/customizationStore";
import { useLiquidGlassStore } from "@/features/liquid-glass";
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
  const loginUi = useAppearanceStore((s) => s.loginUi);
  const setLoginUi = useAppearanceStore((s) => s.setLoginUi);
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
        title={t("settings.appearance.login_ui_title") || "Login screen"}
        description={
          t("settings.appearance.login_ui_description") ||
          "Pick the sign-in design. Original is the classic Liner look; New is the evi-flavored redesign."
        }
        titleKey="settings.appearance.login_ui_title"
        descKey="settings.appearance.login_ui_description"
        searchQuery={searchQuery}
        control={
          <MenuSelect
            options={
              [
                {
                  value: "original",
                  label:
                    t("settings.appearance.login_ui_original") ||
                    "Original (default)",
                },
                {
                  value: "new",
                  label: t("settings.appearance.login_ui_new") || "New",
                },
              ] as const
            }
            value={loginUi}
            onChange={(value: LoginUiVariant) => {
              if (value === loginUi) return;
              setLoginUi(value);
              setRefreshPromptOpen(true);
            }}
            className="min-w-[130px]"
            aria-label={t("settings.appearance.login_ui_title") || "Login screen"}
          />
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
            {t("settings.appearance.login_ui_refresh_body") ||
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
              {t("settings.appearance.login_ui_refresh_okay") || "Okay"}
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
