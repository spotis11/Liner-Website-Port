import { describe, it, expect } from "vitest";
import {
  COLOR_THEMES,
  SELECTABLE_COLOR_THEMES,
  BASE_THEME_IDS,
  getColorThemeDef,
  themeSwatchGradient,
  buildThemePalette,
  hexToHsl,
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToHex,
  hslToRgb,
  yiqBrightness,
  THEME_VARS,
} from "./colorThemes";

describe("colorThemes", () => {
  it("ships the full 26-theme grid with 24 selectable accent themes", () => {
    expect(COLOR_THEMES).toHaveLength(26);
    expect(SELECTABLE_COLOR_THEMES).toHaveLength(24);
    expect(BASE_THEME_IDS.has("light")).toBe(true);
    expect(BASE_THEME_IDS.has("black")).toBe(true);
  });

  it("does not resolve base themes (light/black) as color palettes", () => {
    expect(getColorThemeDef("light")).toBeNull();
    expect(getColorThemeDef("black")).toBeNull();
    expect(getColorThemeDef("solar-flare")?.name).toBe("Solar Flare");
    expect(getColorThemeDef("nope")).toBeNull();
    expect(getColorThemeDef(null)).toBeNull();
  });

  it("converts colors without drift", () => {
    expect(hexToRgb("#ff9a00")).toEqual({ r: 255, g: 154, b: 0 });
    expect(rgbToHex({ r: 255, g: 154, b: 0 })).toBe("#ff9a00");
    const hsl = hexToHsl("#ff9a00");
    expect(hsl.h).toBeGreaterThanOrEqual(34);
    expect(hsl.h).toBeLessThanOrEqual(40);
    const back = hslToHex({ h: hsl.h, s: hsl.s, l: hsl.l });
    expect(Math.abs(yiqBrightness(back) - yiqBrightness("#ff9a00"))).toBeLessThan(6);
    expect(hslToRgb({ h: 0, s: 100, l: 50 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(rgbToHsl({ r: 255, g: 0, b: 0 }).l).toBeCloseTo(50);
  });

  it("builds a complete palette for every theme with no NaN values", () => {
    for (const def of COLOR_THEMES) {
      const palette = buildThemePalette(def);
      for (const v of THEME_VARS) {
        const value = palette[v];
        expect(value, `${def.id}.${v}`).toBeTruthy();
        expect(value.includes("NaN"), `${def.id}.${v}`).toBe(false);
      }
    }
  });

  it("dark palettes produce dark tinted surfaces and legible accents", () => {
    const palette = buildThemePalette(
      COLOR_THEMES.find((t) => t.id === "solar-flare")!,
    );
    expect(hexToHsl(palette["bg-canvas"]).l).toBeLessThan(6);
    expect(hexToHsl(palette["bg-panel"]).l).toBeLessThan(14);
    expect(palette["text-primary"]).toBe("#ffffff");
    // orange accent stays readable on dark backgrounds
    expect(hexToHsl(palette["accent-primary"]).l).toBeGreaterThanOrEqual(53);
    // orange button -> dark label
    expect(palette["btn-primary-text"]).toBe("#000000");
    expect(palette["btn-primary-bg"]).toBe(palette["accent-primary"]);
  });

  it("light palettes keep white surfaces and dark text", () => {
    const palette = buildThemePalette(
      COLOR_THEMES.find((t) => t.id === "matcha-light")!,
    );
    expect(palette["bg-surface"]).toBe("#ffffff");
    expect(hexToHsl(palette["bg-canvas"]).l).toBeGreaterThan(85);
    expect(hexToHsl(palette["text-primary"]).l).toBeLessThan(15);
    // accents darken for contrast on light surfaces
    expect(hexToHsl(palette["accent-primary"]).l).toBeLessThanOrEqual(50);
    expect(palette["btn-primary-text"]).toBe("#ffffff");
  });

  it("keeps neutral defaults for toolbox/glass alphas in both modes", () => {
    const dark = buildThemePalette(
      COLOR_THEMES.find((t) => t.id === "midnight-blue")!,
    );
    const light = buildThemePalette(
      COLOR_THEMES.find((t) => t.id === "misty-blue")!,
    );
    expect(dark["bg-toolbox"]).toBe("rgba(255, 255, 255, 0.04)");
    expect(light["bg-toolbox"]).toBe("rgba(0, 0, 0, 0.04)");
  });

  it("renders swatch gradients", () => {
    const def = COLOR_THEMES.find((t) => t.id === "ruby-velvet")!;
    expect(themeSwatchGradient(def)).toBe(
      "linear-gradient(155deg, #ff4e64 8%, #ff606f 92%)",
    );
  });
});
