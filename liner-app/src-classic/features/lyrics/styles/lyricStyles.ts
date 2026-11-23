import type { LyricsTypography } from "../canvas/types";

/**
 * Lyric style themes for the canvas lyrics renderer — the web-port answer to
 * the desktop app's "Lyrics & pop-up → Browse styles" gallery. Each theme is
 * a set of declarative overrides the canvas engine resolves into a
 * LyricsTypography; the renderer itself stays style-agnostic.
 *
 * Names and categories mirror the original Liner desktop gallery
 * (Karaoke, Spread, Typewriter, Neon, Echo, Glitch, Blur Italic, Drift,
 * Bolt …) grouped into Classic / Neon / Nero / Poster / Kinetic.
 */
export type LyricStyleCategory =
  | "classic"
  | "neon"
  | "nero"
  | "poster"
  | "kinetic";

export interface LyricStyleTheme {
  id: string;
  name: string;
  category: LyricStyleCategory;
  /** font family override (default: the resolved Montserrat family) */
  family?: string;
  weight?: number;
  italic?: boolean;
  uppercase?: boolean;
  /** extra tracking between letters, px at 100% lyric size */
  letterSpacing?: number;
  /** extra gap between word groups (the "Spread" look), px */
  spread?: number;
  /** multiplies the base 32px line size */
  sizeScale?: number;
  /** multiplies the derived line height (default 1.4) */
  lineHeightScale?: number;
  /** fill color of sung text; default white */
  activeColor?: string;
  /** two-stop gradient applied across each sung word */
  activeGradient?: [string, string];
  /** shadow color for glow effects; defaults to the active color */
  glowColor?: string;
  /** multiplies the word-sweep glow (0 disables it) */
  glowScale?: number;
  /** steady halo on sung text, in rem (independent of the sweep) */
  constantGlowRem?: number;
  /** opacity of lines that are not being sung (default 0.3) */
  inactiveAlpha?: number;
  /** gaussian blur on lines that are not being sung, px */
  inactiveBlurPx?: number;
  /** red/cyan fringe on sung text */
  glitch?: boolean;
}

export const LYRIC_STYLE_CATEGORIES: LyricStyleCategory[] = [
  "classic",
  "neon",
  "nero",
  "poster",
  "kinetic",
];

export const LYRICS_BASE_SIZE_PX = 32;
export const LYRICS_LINE_HEIGHT_RATIO = 1.4;

const SERIF_FAMILY =
  "Georgia, 'Times New Roman', 'Noto Serif', ui-serif, serif";
const MONO_FAMILY = "'Geist Mono', ui-monospace, 'SF Mono', monospace";

export const LYRIC_STYLES: LyricStyleTheme[] = [
  {
    id: "karaoke",
    name: "Karaoke",
    category: "classic",
    // the engine's built-in look: white sweep, soft halo on long words
  },
  {
    id: "spread",
    name: "Spread",
    category: "classic",
    letterSpacing: 5,
    spread: 12,
    sizeScale: 0.94,
  },
  {
    id: "typewriter",
    name: "Typewriter",
    category: "classic",
    family: MONO_FAMILY,
    weight: 700,
    letterSpacing: 1.5,
  },
  {
    id: "headline",
    name: "Headline",
    category: "poster",
    uppercase: true,
    weight: 800,
    letterSpacing: 2,
    glowScale: 0,
    inactiveAlpha: 0.22,
  },
  {
    id: "shadow",
    name: "Shadow",
    category: "nero",
    weight: 700,
    glowColor: "rgba(0, 0, 0, 0.85)",
    constantGlowRem: 1.1,
    glowScale: 0,
    inactiveAlpha: 0.12,
  },
  {
    id: "blur-italic",
    name: "Blur Italic",
    category: "nero",
    family: SERIF_FAMILY,
    italic: true,
    weight: 500,
    sizeScale: 1.06,
    inactiveBlurPx: 7,
    inactiveAlpha: 0.42,
    glowScale: 0.6,
  },
  {
    id: "neon",
    name: "Neon",
    category: "neon",
    activeColor: "#ff5fd2",
    glowColor: "#ff5fd2",
    constantGlowRem: 0.9,
    glowScale: 1.6,
    inactiveAlpha: 0.35,
  },
  {
    id: "echo",
    name: "Echo",
    category: "neon",
    inactiveBlurPx: 4,
    inactiveAlpha: 0.2,
    sizeScale: 1.04,
    glowScale: 1.2,
  },
  {
    id: "glitch",
    name: "Glitch",
    category: "neon",
    glitch: true,
    glowScale: 0,
    inactiveAlpha: 0.25,
  },
  {
    id: "drift",
    name: "Drift",
    category: "kinetic",
    uppercase: true,
    weight: 700,
    letterSpacing: 3,
    activeColor: "#7ad7ff",
    glowColor: "#39b7ff",
    constantGlowRem: 0.8,
    glowScale: 1.2,
    inactiveAlpha: 0.26,
  },
  {
    id: "bolt",
    name: "Bolt",
    category: "kinetic",
    uppercase: true,
    weight: 900,
    sizeScale: 1.08,
    activeColor: "#ffd166",
    glowColor: "#ff4d6d",
    constantGlowRem: 1,
    glowScale: 1.4,
    inactiveAlpha: 0.24,
  },
  {
    id: "candy",
    name: "Candy",
    category: "poster",
    weight: 700,
    activeGradient: ["#ff6ec4", "#7873ff"],
    glowScale: 1.1,
  },
];

export const DEFAULT_LYRIC_STYLE_ID = "karaoke";

export function getLyricStyle(id: string): LyricStyleTheme {
  return (
    LYRIC_STYLES.find((style) => style.id === id) ??
    LYRIC_STYLES.find((style) => style.id === DEFAULT_LYRIC_STYLE_ID)!
  );
}

/** User-tunable knobs from Settings → Lyrics (store state shape). */
export interface LyricStylePrefs {
  sizePct: number;
  customColorEnabled: boolean;
  customColor: string;
  glowEnabled: boolean;
  glowStrength: number;
}

export const LYRIC_SIZE_MIN_PCT = 60;
export const LYRIC_SIZE_MAX_PCT = 180;
export const LYRIC_GLOW_MIN = 0.5;
export const LYRIC_GLOW_MAX = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Resolve a style + user prefs into the renderer's LyricsTypography. The
 * family field stays undefined so the scene keeps the host-resolved
 * Montserrat family unless the style names its own font.
 */
export function resolveLyricsTypography(
  style: LyricStyleTheme,
  prefs: LyricStylePrefs,
): LyricsTypography {
  const sizeScale = (prefs.sizePct / 100) * (style.sizeScale ?? 1);
  const size = Math.round(LYRICS_BASE_SIZE_PX * sizeScale * 10) / 10;
  const lineHeightRatio = style.lineHeightScale ?? LYRICS_LINE_HEIGHT_RATIO;
  const glowScale =
    (prefs.glowEnabled ? (style.glowScale ?? 1) * prefs.glowStrength : 0) || 0;
  return {
    family: style.family ?? "",
    size,
    weight: style.weight ?? 600,
    lineHeight: Math.round(size * lineHeightRatio * 10) / 10,
    paddingY: 20,
    paddingX: 8,
    italic: style.italic,
    uppercase: style.uppercase,
    letterSpacing: style.letterSpacing
      ? Math.round(style.letterSpacing * sizeScale * 10) / 10
      : undefined,
    spread: style.spread ? Math.round(style.spread * sizeScale * 10) / 10 : undefined,
    activeColor: prefs.customColorEnabled
      ? prefs.customColor
      : (style.activeColor ?? null),
    activeGradient: prefs.customColorEnabled ? undefined : style.activeGradient,
    glowColor: style.glowColor,
    glowScale,
    constantGlowRem: glowScale > 0 ? (style.constantGlowRem ?? 0) * prefs.glowStrength : 0,
    inactiveAlpha: style.inactiveAlpha,
    inactiveBlurPx: style.inactiveBlurPx,
    glitch: style.glitch,
  };
}

export { clamp as clampLyricStyleValue };
