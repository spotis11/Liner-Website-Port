// Onboarding wizard steps: profile picture → artists → theme.

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { AddLine } from "@mingcute/react";
import { useTranslation } from "@/languages";
import { useToast } from "@/shared/ui";
import { useAuthStore } from "@/features/auth";
import { useAppearanceStore } from "@/features/settings/store/appearanceStore";
import { useCustomizationStore } from "@/features/settings/store/customizationStore";
import {
  AvatarProcessException,
  fileToAvatarDataUrl,
  isAcceptableAvatarFile,
} from "@/features/settings/lib/avatarImage";
import { ColorThemeCard } from "@/features/settings/ui/tabs/ColorThemeCard";
import { COLOR_THEMES, themeSwatchGradient } from "@/features/settings/store/colorThemes";
import {
  fetchPopularArtistOptions,
  type PopularArtistOption,
} from "../lib/popularArtists";
import {
  MAX_ARTIST_PICKS,
  useWelcomeStore,
} from "../store/welcomeStore";

// ---------------------------------------------------------------------------
// Step 1 — profile picture
// ---------------------------------------------------------------------------

export function ProfilePictureStep() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const draftAvatar = useWelcomeStore(
    (s) => s.active?.kind === "signup" ? s.active.draft.avatarUrl : null,
  );
  const setDraftAvatar = useWelcomeStore((s) => s.setDraftAvatar);
  const accountAvatar = useAuthStore((s) => s.user?.avatarUrl ?? null);

  const preview = draftAvatar ?? accountAvatar ?? null;

  const handleFile = async (file: File) => {
    if (busy) return;
    if (!isAcceptableAvatarFile(file)) {
      toast(t("settings.profile.avatar_invalid"), "error");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setDraftAvatar(dataUrl);
    } catch (error) {
      if (error instanceof AvatarProcessException) {
        toast(
          error.reason === "too_large"
            ? t("settings.profile.avatar_too_large")
            : t("settings.profile.avatar_invalid"),
          "error",
        );
      } else {
        toast(t("settings.profile.avatar_invalid"), "error");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center">
      <p className="mb-[18px] text-[15px] font-semibold text-white/90">
        {t("welcome.avatar_title")}
      </p>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.target.value = "";
        }}
      />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        aria-label={t("welcome.avatar_title")}
        className="group relative h-[116px] w-[116px] cursor-pointer rounded-full border-2 border-dashed border-white/25 bg-white/[0.05] transition-all hover:border-[#3ddc97]/70 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3ddc97]/60 disabled:cursor-wait"
      >
        {preview ? (
          <img
            src={preview}
            alt=""
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-[4px] text-white/55 transition-colors group-hover:text-white/80">
            <AddLine className="h-[30px] w-[30px]" />
          </span>
        )}
        {busy ? (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-[12px] font-medium text-white/90">
            …
          </span>
        ) : preview ? (
          <span className="absolute bottom-[2px] right-[2px] flex h-[30px] w-[30px] items-center justify-center rounded-full border border-black/30 bg-[#17b26a] text-white shadow-md">
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2 6.5L4.5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ) : null}
      </button>

      <p className="mt-[14px] text-center text-[13px] leading-relaxed text-white/55">
        {t("welcome.avatar_helper")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — pick 3 artists you listen to
// ---------------------------------------------------------------------------

function usePopularArtistOptions() {
  const [options, setOptions] = useState<PopularArtistOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    fetchPopularArtistOptions()
      .then((opts) => {
        if (cancelled) return;
        setOptions(opts);
        setFailed(opts.length === 0);
      })
      .catch(() => {
        if (cancelled) return;
        setOptions([]);
        setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { options, loading, failed, retry: () => setAttempt((a) => a + 1) };
}

export function ArtistsStep() {
  const { t } = useTranslation();
  const { options, loading, failed, retry } = usePopularArtistOptions();
  const artistIds = useWelcomeStore(
    (s) => s.active?.kind === "signup" ? s.active.draft.artistIds : [],
  );
  const toggleArtist = useWelcomeStore((s) => s.toggleArtist);

  return (
    <div>
      {loading ? (
        <div className="grid grid-cols-3 gap-[14px] sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-[8px]">
              <div className="h-[72px] w-[72px] animate-pulse rounded-full bg-white/[0.07]" />
              <div className="h-[10px] w-[64px] animate-pulse rounded-full bg-white/[0.06]" />
            </div>
          ))}
        </div>
      ) : failed && options.length === 0 ? (
        <div className="flex flex-col items-center gap-[12px] py-[26px] text-center">
          <p className="text-[13.5px] text-white/65">
            {t("welcome.artists_load_failed")}
          </p>
          <div className="flex items-center gap-[14px]">
            <button
              type="button"
              onClick={retry}
              className="cursor-pointer rounded-[12px] border border-white/15 px-[14px] py-[8px] text-[13px] font-medium text-white/85 transition-colors hover:bg-white/10"
            >
              {t("welcome.artists_retry")}
            </button>
            <button
              type="button"
              onClick={() => useWelcomeStore.getState().setArtistsEscape(true)}
              className="cursor-pointer text-[13px] font-medium text-[#3ddc97] underline-offset-4 hover:underline"
            >
              {t("welcome.artists_skip")}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-x-[14px] gap-y-[16px] sm:grid-cols-4">
          {options.map((artist) => {
            const selected = artistIds.includes(artist.id);
            const locked = !selected && artistIds.length >= MAX_ARTIST_PICKS;
            return (
              <button
                key={artist.id}
                type="button"
                onClick={() => toggleArtist(artist.id)}
                aria-pressed={selected}
                title={artist.name}
                className={`group flex min-w-0 cursor-pointer flex-col items-center gap-[8px] border-0 bg-transparent p-0 transition-opacity ${
                  locked ? "opacity-45" : ""
                }`}
              >
                <span
                  className={`relative block h-[72px] w-[72px] shrink-0 overflow-hidden rounded-full border-2 transition-all ${
                    selected
                      ? "border-[#3ddc97] shadow-[0_0_0_3px_rgba(61,220,151,0.25)]"
                      : "border-white/10 group-hover:border-white/35"
                  }`}
                >
                  {artist.coverUrl ? (
                    <img
                      src={artist.coverUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-white/[0.08] text-[22px] font-bold text-white/70">
                      {artist.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  {selected ? (
                    <span className="absolute bottom-[-2px] right-[-2px] flex h-[24px] w-[24px] items-center justify-center rounded-full border-2 border-[#0f1210] bg-[#17b26a]">
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                        <path d="M2 6.5L4.5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  ) : null}
                </span>
                <span className="w-full truncate text-center text-[12px] leading-tight text-white/80">
                  {artist.name}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-[16px] flex items-center justify-center">
        <span
          className={`rounded-full border px-[14px] py-[6px] text-[12.5px] font-semibold transition-colors ${
            artistIds.length === MAX_ARTIST_PICKS
              ? "border-[#3ddc97]/50 bg-[#3ddc97]/15 text-[#7ef0bd]"
              : "border-white/12 bg-white/[0.05] text-white/65"
          }`}
        >
          {t("welcome.artists_counter", { count: artistIds.length })}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — theme
// ---------------------------------------------------------------------------

export function ThemeStep() {
  const { t } = useTranslation();
  const { theme, resolvedTheme, setTheme } = useTheme();

  const colorThemeId = useAppearanceStore((s) => s.colorThemeId);
  const setColorTheme = useAppearanceStore((s) => s.setColorTheme);
  const setSameAsDevice = useAppearanceStore((s) => s.setSameAsDevice);
  const colorThemeActive = useAppearanceStore((s) => s.colorThemeId !== null);

  const clearWallpaper = useCustomizationStore((s) => s.setBackgroundImage);

  const handleBase = (mode: "light" | "dark") => {
    setColorTheme(null);
    setSameAsDevice(false);
    setTheme(mode);
  };

  const handleColor = (id: string) => {
    // Theme/wallpaper interlock: the theme wins (same rule as Appearance).
    if (useCustomizationStore.getState().backgroundImage) {
      clearWallpaper(null);
    }
    setColorTheme(id);
  };

  return (
    <div>
      <div className="grid grid-cols-4 gap-[10px] sm:grid-cols-6">
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
              onSelect={() =>
                isBase
                  ? handleBase(def.id === "light" ? "light" : "dark")
                  : handleColor(def.id)
              }
            />
          );
        })}
      </div>

      <p className="mt-[14px] text-center text-[13px] leading-relaxed text-white/55">
        {t("welcome.theme_helper")}
      </p>
    </div>
  );
}
