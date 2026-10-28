import { describe, it, expect, afterEach } from "vitest";
import {
  createAppearanceStore,
  applyColorThemeToDocument,
  decideWallpaperPermission,
  APPEARANCE_STORAGE_KEY,
  selectIsColorThemeActive,
} from "./appearanceStore";
import { buildThemePalette, SELECTABLE_COLOR_THEMES } from "./colorThemes";

function memoryStorage(seed?: Record<string, string>): Storage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getLength: () => map.size,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  } as unknown as Storage;
}

function appliedInlineVars(): string[] {
  const style = document.documentElement.style;
  return Array.from({ length: style.length }, (_, i) => style[i] ?? "");
}

afterEach(() => {
  applyColorThemeToDocument(null);
});

describe("appearanceStore", () => {
  it("starts with no color theme and same-as-device enabled", () => {
    const store = createAppearanceStore(memoryStorage());
    const state = store.getState();
    expect(state.colorThemeId).toBeNull();
    expect(state.sameAsDevice).toBe(true);
    expect(selectIsColorThemeActive(state)).toBe(false);
    expect(document.documentElement.getAttribute("data-color-theme")).toBeNull();
  });

  it("applies the palette as inline variables and data attribute", () => {
    const store = createAppearanceStore(memoryStorage());
    store.getState().setColorTheme("solar-flare");

    expect(document.documentElement.getAttribute("data-color-theme")).toBe("solar-flare");
    const expected = buildThemePalette(
      SELECTABLE_COLOR_THEMES.find((t) => t.id === "solar-flare")!,
    );
    expect(
      document.documentElement.style.getPropertyValue("--accent-primary"),
    ).toBe(expected["accent-primary"]);
    expect(document.documentElement.style.getPropertyValue("--text-primary")).toBe("#ffffff");
    expect(appliedInlineVars().length).toBeGreaterThan(20);
  });

  it("clears the palette and attribute when the theme is deselected", () => {
    const storage = memoryStorage();
    const store = createAppearanceStore(storage);
    store.getState().setColorTheme("ruby-velvet");
    expect(document.documentElement.getAttribute("data-color-theme")).toBe("ruby-velvet");

    store.getState().setColorTheme(null);
    expect(document.documentElement.getAttribute("data-color-theme")).toBeNull();
    expect(appliedInlineVars()).toHaveLength(0);
    expect(JSON.parse(storage.getItem(APPEARANCE_STORAGE_KEY)!)).toEqual({
      colorThemeId: null,
      sameAsDevice: true,
    });
  });

  it("ignores invalid theme ids (including base ids and garbage)", () => {
    const store = createAppearanceStore(memoryStorage());
    store.getState().setColorTheme("light");
    expect(store.getState().colorThemeId).toBeNull();
    store.getState().setColorTheme("not-a-theme");
    expect(store.getState().colorThemeId).toBeNull();
    expect(document.documentElement.getAttribute("data-color-theme")).toBeNull();
  });

  it("hydrates synchronously from storage and applies before first use", () => {
    const storage = memoryStorage({
      [APPEARANCE_STORAGE_KEY]: JSON.stringify({
        colorThemeId: "ocean-fm-dark",
        sameAsDevice: false,
      }),
    });
    const store = createAppearanceStore(storage);
    expect(store.getState().colorThemeId).toBe("ocean-fm-dark");
    expect(store.getState().sameAsDevice).toBe(false);
    expect(document.documentElement.getAttribute("data-color-theme")).toBe("ocean-fm-dark");
  });

  it("falls back cleanly on corrupt or invalid persisted records", () => {
    const corrupt = createAppearanceStore(
      memoryStorage({ [APPEARANCE_STORAGE_KEY]: "{not json" }),
    );
    expect(corrupt.getState().colorThemeId).toBeNull();

    const stale = createAppearanceStore(
      memoryStorage({
        [APPEARANCE_STORAGE_KEY]: JSON.stringify({
          colorThemeId: "theme-from-an-old-build",
          sameAsDevice: false,
        }),
      }),
    );
    expect(stale.getState().colorThemeId).toBeNull();
    expect(stale.getState().sameAsDevice).toBe(false);
  });

  it("tolerates a throwing storage without crashing", () => {
    const hostile: Storage = {
      ...memoryStorage(),
      setItem: () => {
        throw new Error("quota exceeded");
      },
    } as unknown as Storage;
    const store = createAppearanceStore(hostile);
    expect(() => store.getState().setColorTheme("teal-lagoon")).not.toThrow();
    expect(store.getState().colorThemeId).toBe("teal-lagoon");
    expect(document.documentElement.getAttribute("data-color-theme")).toBe("teal-lagoon");
  });

  it("keeps same-as-device independent from the color theme", () => {
    const storage = memoryStorage();
    const store = createAppearanceStore(storage);
    store.getState().setColorTheme("lavender");
    store.getState().setSameAsDevice(false);
    expect(JSON.parse(storage.getItem(APPEARANCE_STORAGE_KEY)!)).toEqual({
      colorThemeId: "lavender",
      sameAsDevice: false,
    });
  });

  it("drops the removed Liquid Glass fields from legacy persisted records", () => {
    const store = createAppearanceStore(
      memoryStorage({
        [APPEARANCE_STORAGE_KEY]: JSON.stringify({
          colorThemeId: "ocean-fm-dark",
          sameAsDevice: true,
          liquidGlass: true,
          liquidGlassTransparency: 30,
        }),
      }),
    );
    // The theme survives; the glass fields are gone and glass never re-enables.
    expect(store.getState().colorThemeId).toBe("ocean-fm-dark");
    expect("liquidGlass" in store.getState()).toBe(false);
    expect(
      document.documentElement.getAttribute("data-liquid-glass"),
    ).toBeNull();
  });

  describe("decideWallpaperPermission", () => {
    it("blocks wallpapers while a color theme is applied", () => {
      expect(decideWallpaperPermission({ colorThemeId: "solar-flare" })).toEqual({
        allowed: false,
        reason: "color_theme_active",
      });
      expect(decideWallpaperPermission({ colorThemeId: null })).toEqual({
        allowed: true,
        reason: "ok",
      });
    });
  });
});
