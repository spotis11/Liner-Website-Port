import { describe, it, expect } from "vitest";
import {
  LYRIC_STYLES,
  LYRIC_STYLE_CATEGORIES,
  DEFAULT_LYRIC_STYLE_ID,
  getLyricStyle,
  resolveLyricsTypography,
} from "./lyricStyles";

describe("lyric styles registry", () => {
  it("has unique ids and a valid category on every style", () => {
    const ids = new Set<string>();
    for (const style of LYRIC_STYLES) {
      expect(ids.has(style.id)).toBe(false);
      ids.add(style.id);
      expect(LYRIC_STYLE_CATEGORIES).toContain(style.category);
      expect(style.name.length).toBeGreaterThan(0);
    }
  });

  it("falls back to the default style for unknown ids", () => {
    const style = getLyricStyle("does-not-exist");
    expect(style.id).toBe(DEFAULT_LYRIC_STYLE_ID);
    expect(getLyricStyle(DEFAULT_LYRIC_STYLE_ID).id).toBe(
      DEFAULT_LYRIC_STYLE_ID,
    );
  });
});

describe("resolveLyricsTypography", () => {
  const basePrefs = {
    sizePct: 100,
    customColorEnabled: false,
    customColor: "#ffffff",
    glowEnabled: true,
    glowStrength: 1,
  };

  it("keeps the engine default for the karaoke style", () => {
    const type = resolveLyricsTypography(getLyricStyle("karaoke"), basePrefs);
    expect(type.size).toBe(32);
    expect(type.weight).toBe(600);
    expect(type.lineHeight).toBeCloseTo(44.8);
    expect(type.activeColor ?? null).toBeNull();
    expect(type.uppercase).toBeUndefined();
    expect(type.glowScale).toBe(1);
  });

  it("scales size and letter spacing with the lyric size preference", () => {
    const type = resolveLyricsTypography(
      getLyricStyle("spread"),
      { ...basePrefs, sizePct: 150 },
    );
    // scale factor = sizePct/100 * style.sizeScale = 1.5 * 0.94 = 1.41
    // (spacing/spread are rounded to 0.1px, hence the loose precision)
    expect(type.size).toBeCloseTo(45.1, 1);
    expect((type.letterSpacing ?? 0) / 5).toBeCloseTo(1.41, 1);
    expect((type.spread ?? 0) / 12).toBeCloseTo(1.41, 1);
  });

  it("applies the blur-italic theme's font, italic and blur", () => {
    const type = resolveLyricsTypography(
      getLyricStyle("blur-italic"),
      basePrefs,
    );
    expect(type.italic).toBe(true);
    expect(type.family).toContain("Georgia");
    expect(type.inactiveBlurPx).toBe(7);
    expect(type.inactiveAlpha).toBeCloseTo(0.42);
    expect(type.weight).toBe(500);
  });

  it("custom color overrides the style color but not the gradient flag", () => {
    const neon = resolveLyricsTypography(getLyricStyle("neon"), {
      ...basePrefs,
      customColorEnabled: true,
      customColor: "#00ff88",
    });
    expect(neon.activeColor).toBe("#00ff88");

    const candy = resolveLyricsTypography(getLyricStyle("candy"), {
      ...basePrefs,
      customColorEnabled: true,
      customColor: "#00ff88",
    });
    expect(candy.activeGradient).toBeUndefined();
    expect(candy.activeColor).toBe("#00ff88");
  });

  it("glow disabled zeroes out sweep and constant glow", () => {
    const type = resolveLyricsTypography(getLyricStyle("bolt"), {
      ...basePrefs,
      glowEnabled: false,
    });
    expect(type.glowScale).toBe(0);
    expect(type.constantGlowRem).toBe(0);
  });

  it("glow strength multiplies the constant halo", () => {
    const type = resolveLyricsTypography(getLyricStyle("bolt"), {
      ...basePrefs,
      glowStrength: 2,
    });
    expect(type.constantGlowRem).toBeCloseTo(2, 5);
    expect(type.glowScale).toBeCloseTo(2.8, 5);
  });
});
