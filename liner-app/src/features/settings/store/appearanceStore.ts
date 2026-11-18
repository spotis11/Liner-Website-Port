// Appearance store: active color theme and the "same as device theme" toggle.
// Website-port feature mirroring the Liner Appearance panel.
// Persistence is synchronous (first paint carries the theme, like banStore),
// and the palette is applied as inline CSS custom properties on :root so it
// deterministically overrides both light and dark base palettes.

import { create } from "zustand";
import {
  COLOR_THEMES,
  SELECTABLE_COLOR_THEMES,
  THEME_VARS,
  buildThemePalette,
  getColorThemeDef,
  type ThemePalette,
  type ThemeVar,
} from "./colorThemes";

export const APPEARANCE_STORAGE_KEY = "liner_web_appearance_v1";

/** Which whole-app design renders. "original" is the classic Liner look
 * (website default, the frozen src-classic tree); "new" is the upstream
 * 0.2.12 redesign merged into src/. One setting drives the app shell and
 * the sign-in page; switching pops the Liner refresh prompt. */
export type UiStyle = "original" | "new" | "material3";
export const UI_STYLES: UiStyle[] = ["original", "new", "material3"];

export interface AppearanceState {
  /** Active accent color theme id; null = default Liner look. */
  colorThemeId: string | null;
  /** Follow the device light/dark setting (next-themes "system"). */
  sameAsDevice: boolean;
  /** Whole-app design ("original" default). */
  uiStyle: UiStyle;
  setColorTheme: (id: string | null) => void;
  setSameAsDevice: (value: boolean) => void;
  setUiStyle: (value: UiStyle) => void;
}

export function selectIsColorThemeActive(state: {
  colorThemeId: string | null;
}): boolean {
  return state.colorThemeId !== null;
}

// ---------------------------------------------------------------------------
// DOM application
// ---------------------------------------------------------------------------

export function applyColorThemeToDocument(id: string | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const def = getColorThemeDef(id);
  if (!def) {
    root.removeAttribute("data-color-theme");
    for (const v of THEME_VARS) root.style.removeProperty(`--${v}`);
    return;
  }
  const palette = buildThemePalette(def);
  root.setAttribute("data-color-theme", def.id);
  for (const [name, value] of Object.entries(palette)) {
    root.style.setProperty(`--${name}`, value);
  }
}

// ---------------------------------------------------------------------------
// Persistence (sync hydration, tolerant of corrupt records / storage failures)
// ---------------------------------------------------------------------------

interface PersistedAppearance {
  colorThemeId: string | null;
  sameAsDevice: boolean;
  uiStyle?: UiStyle;
  /** Pre-rename field (the toggle briefly shipped as a login-screen-only
   * setting); read for migration so early opt-ins keep the new design. */
  loginUi?: UiStyle;
  /** Legacy no-op fields from the removed Liquid Glass feature; parsed and
   * dropped so old records stay readable without re-enabling anything. */
  liquidGlass?: boolean;
  liquidGlassTransparency?: number;
}

const VALID_IDS = new Set(SELECTABLE_COLOR_THEMES.map((t) => t.id));

function readPersistedUiStyle(value: unknown): UiStyle {
  return typeof value === "string" && (UI_STYLES as string[]).includes(value)
    ? (value as UiStyle)
    : "original";
}

/** Synchronous read used by the entry point (main.tsx) so the right design
 * tree is dynamic-imported on the very first paint — without pulling the
 * redesign chunk (or even the store) into the initial bundle. */
export function readPersistedUiStyleFromStorage(
  storage: Storage | null = defaultStorage(),
): UiStyle {
  const persisted = readPersistedAppearance(storage);
  return readPersistedUiStyle(persisted.uiStyle ?? persisted.loginUi);
}

function readPersistedAppearance(storage: Storage | null): PersistedAppearance {
  const fallback: PersistedAppearance = {
    colorThemeId: null,
    sameAsDevice: true,
    uiStyle: "original",
  };
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedAppearance> | null;
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      colorThemeId:
        typeof parsed.colorThemeId === "string" && VALID_IDS.has(parsed.colorThemeId)
          ? parsed.colorThemeId
          : null,
      sameAsDevice:
        typeof parsed.sameAsDevice === "boolean" ? parsed.sameAsDevice : true,
      uiStyle: readPersistedUiStyle(parsed.uiStyle ?? parsed.loginUi),
    };
  } catch {
    return fallback;
  }
}

function writePersistedAppearance(
  storage: Storage | null,
  value: PersistedAppearance,
): void {
  if (!storage) return;
  try {
    storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage outages (private mode / quota) must never crash the app.
  }
}

function defaultStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Wallpaper interlock (pure decision, shared by UI + tests)
// ---------------------------------------------------------------------------

export type WallpaperBlockReason = "ok" | "color_theme_active";

export function decideWallpaperPermission(state: {
  colorThemeId: string | null;
}): { allowed: boolean; reason: WallpaperBlockReason } {
  return state.colorThemeId !== null
    ? { allowed: false, reason: "color_theme_active" }
    : { allowed: true, reason: "ok" };
}

// ---------------------------------------------------------------------------
// Store factory (injectable storage keeps it unit-testable)
// ---------------------------------------------------------------------------

export function createAppearanceStore(
  storage: Storage | null = defaultStorage(),
) {
  const initial = readPersistedAppearance(storage);
  // Apply the persisted theme immediately so the very first paint carries it.
  applyColorThemeToDocument(initial.colorThemeId);

  const persist = (state: Partial<AppearanceState>): void => {
    const merged = { ...readPersistedAppearance(storage), ...state };
    writePersistedAppearance(storage, {
      colorThemeId: merged.colorThemeId,
      sameAsDevice: merged.sameAsDevice,
      uiStyle: readPersistedUiStyle(merged.uiStyle ?? merged.loginUi),
    });
  };

  const store = create<AppearanceState>()((set) => ({
    colorThemeId: initial.colorThemeId,
    sameAsDevice: initial.sameAsDevice,
    uiStyle: readPersistedUiStyle(initial.uiStyle ?? initial.loginUi),
    setColorTheme: (id) => {
      const next = getColorThemeDef(id) ? id : null;
      set({ colorThemeId: next });
      persist({ colorThemeId: next });
      applyColorThemeToDocument(next);
    },
    setSameAsDevice: (value) => {
      set({ sameAsDevice: value });
      persist({ sameAsDevice: value });
    },
    setUiStyle: (value) => {
      const next = (UI_STYLES as string[]).includes(value)
        ? value
        : "original";
      set({ uiStyle: next });
      persist({ uiStyle: next });
    },
  }));

  return store;
}

/** Default singleton store (also applies any persisted theme at import time). */
export const useAppearanceStore = createAppearanceStore();

export { COLOR_THEMES, SELECTABLE_COLOR_THEMES };
export type { ThemePalette, ThemeVar };
