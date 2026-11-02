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

export interface AppearanceState {
  /** Active accent color theme id; null = default Liner look. */
  colorThemeId: string | null;
  /** Follow the device light/dark setting (next-themes "system"). */
  sameAsDevice: boolean;
  setColorTheme: (id: string | null) => void;
  setSameAsDevice: (value: boolean) => void;
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
  /** Legacy no-op fields from the removed Liquid Glass feature; parsed and
   * dropped so old records stay readable without re-enabling anything. */
  liquidGlass?: boolean;
  liquidGlassTransparency?: number;
}

const VALID_IDS = new Set(SELECTABLE_COLOR_THEMES.map((t) => t.id));

function readPersistedAppearance(storage: Storage | null): PersistedAppearance {
  const fallback: PersistedAppearance = {
    colorThemeId: null,
    sameAsDevice: true,
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
    });
  };

  const store = create<AppearanceState>()((set) => ({
    colorThemeId: initial.colorThemeId,
    sameAsDevice: initial.sameAsDevice,
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
  }));

  return store;
}

/** Default singleton store (also applies any persisted theme at import time). */
export const useAppearanceStore = createAppearanceStore();

export { COLOR_THEMES, SELECTABLE_COLOR_THEMES };
export type { ThemePalette, ThemeVar };
