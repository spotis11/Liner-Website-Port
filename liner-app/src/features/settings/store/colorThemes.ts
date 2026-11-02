// Color themes for the Appearance settings (website port feature).
// 26 themes matching the Liner "Appearance" panel: Light + Black included,
// 24 accent color themes derived from swatches sampled from the real app.
// Pure module: no DOM / storage access (unit-testable).

export interface ColorThemeDef {
  id: string;
  name: string;
  /** Base look the palette is built on. */
  mode: "light" | "dark";
  /** Swatch gradient start (also the primary accent seed). */
  accentFrom: string;
  /** Swatch gradient end (secondary accent seed). */
  accentTo: string;
}

/** Light/Black are classic base themes handled via next-themes, not palettes. */
export const BASE_THEME_IDS = new Set<string>(["light", "black"]);

export const COLOR_THEMES: ColorThemeDef[] = [
  // Row 1
  { id: "light", name: "Light", mode: "light", accentFrom: "#fafafa", accentTo: "#e9e9ec" },
  { id: "black", name: "Black", mode: "dark", accentFrom: "#0a0a0a", accentTo: "#1b1c1f" },
  { id: "cherry-pop-light", name: "Cherry Pop Light", mode: "light", accentFrom: "#ff9396", accentTo: "#ffab9b" },
  { id: "electric-dream-light", name: "Electric Dream Light", mode: "light", accentFrom: "#cb80f7", accentTo: "#e777f5" },
  { id: "ocean-fm-light", name: "Ocean FM Light", mode: "light", accentFrom: "#00c4f2", accentTo: "#00b1f7" },
  { id: "matcha-light", name: "Matcha Light", mode: "light", accentFrom: "#86e045", accentTo: "#a4ed59" },
  { id: "golden-hour-light", name: "Golden Hour Light", mode: "light", accentFrom: "#d6893d", accentTo: "#ff912b" },
  { id: "cotton-candy-light", name: "Cotton Candy Light", mode: "light", accentFrom: "#f780c4", accentTo: "#e29ae2" },
  // Row 2
  { id: "misty-blue", name: "Misty Blue", mode: "light", accentFrom: "#60a9fa", accentTo: "#92adfb" },
  { id: "lavender", name: "Lavender", mode: "light", accentFrom: "#a270f5", accentTo: "#b68ff8" },
  { id: "coral-bloom", name: "Coral Bloom", mode: "light", accentFrom: "#ff7f71", accentTo: "#ff9a6c" },
  { id: "mint-breeze", name: "Mint Breeze", mode: "light", accentFrom: "#00e0bf", accentTo: "#4ce5c0" },
  { id: "lemon-cream", name: "Lemon Cream", mode: "light", accentFrom: "#ffd543", accentTo: "#ffe065" },
  { id: "rosewood", name: "Rosewood", mode: "light", accentFrom: "#e976c5", accentTo: "#da7ce5" },
  { id: "cherry-pop-dark", name: "Cherry Pop Dark", mode: "dark", accentFrom: "#ff685d", accentTo: "#ff865b" },
  { id: "electric-dream-dark", name: "Electric Dream Dark", mode: "dark", accentFrom: "#c34fcc", accentTo: "#eb43a4" },
  // Row 3
  { id: "ocean-fm-dark", name: "Ocean FM Dark", mode: "dark", accentFrom: "#00a6de", accentTo: "#0096e7" },
  { id: "matcha-dark", name: "Matcha Dark", mode: "dark", accentFrom: "#64b63f", accentTo: "#7dcb58" },
  { id: "golden-hour-dark", name: "Golden Hour Dark", mode: "dark", accentFrom: "#ff8400", accentTo: "#ff7500" },
  { id: "cotton-candy-dark", name: "Cotton Candy Dark", mode: "dark", accentFrom: "#e35fbb", accentTo: "#c874dd" },
  { id: "midnight-blue", name: "Midnight Blue", mode: "dark", accentFrom: "#4686f5", accentTo: "#6788f6" },
  { id: "teal-lagoon", name: "Teal Lagoon", mode: "dark", accentFrom: "#00d6d1", accentTo: "#00e4ed" },
  { id: "ruby-velvet", name: "Ruby Velvet", mode: "dark", accentFrom: "#ff4e64", accentTo: "#ff606f" },
  { id: "solar-flare", name: "Solar Flare", mode: "dark", accentFrom: "#ff9a00", accentTo: "#ffb900" },
  // Row 4
  { id: "frosted-silver", name: "Frosted Silver", mode: "light", accentFrom: "#8394a2", accentTo: "#a2afbb" },
  { id: "forest-glow", name: "Forest Glow", mode: "dark", accentFrom: "#00bb5f", accentTo: "#00cc6d" },
];

/** The 24 accent themes that can be set as the active color theme. */
export const SELECTABLE_COLOR_THEMES = COLOR_THEMES.filter(
  (t) => !BASE_THEME_IDS.has(t.id),
);

export function getColorThemeDef(id: string | null | undefined): ColorThemeDef | null {
  if (!id) return null;
  return SELECTABLE_COLOR_THEMES.find((t) => t.id === id) ?? null;
}

export function themeSwatchGradient(def: ColorThemeDef): string {
  return `linear-gradient(155deg, ${def.accentFrom} 8%, ${def.accentTo} 92%)`;
}

// ---------------------------------------------------------------------------
// Color math
// ---------------------------------------------------------------------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
}
export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "").trim();
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const num = Number.parseInt(full, 16);
  if (!Number.isFinite(num)) return { r: 0, g: 0, b: 0 };
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamped = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${clamped(r)}${clamped(g)}${clamped(b)}`;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hn = ((h % 360) + 360) % 360;
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const ln = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = ln - c / 2;
  let rgb: [number, number, number];
  if (hn < 60) rgb = [c, x, 0];
  else if (hn < 120) rgb = [x, c, 0];
  else if (hn < 180) rgb = [0, c, x];
  else if (hn < 240) rgb = [0, x, c];
  else if (hn < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return {
    r: (rgb[0] + m) * 255,
    g: (rgb[1] + m) * 255,
    b: (rgb[2] + m) * 255,
  };
}

export function hexToHsl(hex: string): Hsl {
  return rgbToHsl(hexToRgb(hex));
}

export function hslToHex(hsl: Hsl): string {
  return rgbToHex(hslToRgb(hsl));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function rgba(rgb: Rgb, alpha: number): string {
  const r = Math.round(clamp(rgb.r, 0, 255));
  const g = Math.round(clamp(rgb.g, 0, 255));
  const b = Math.round(clamp(rgb.b, 0, 255));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Perceived brightness (YIQ 0-255); >=150 reads as light. */
export function yiqBrightness(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (299 * r + 587 * g + 114 * b) / 1000;
}

// ---------------------------------------------------------------------------
// Palette builder: theme def -> full CSS custom property set
// ---------------------------------------------------------------------------

export const THEME_VARS = [
  "bg-canvas",
  "bg-surface",
  "bg-primary",
  "bg-elevated",
  "bg-panel",
  "bg-overlay",
  "bg-toolbox",
  "bg-toolbox-active",
  "bg-glass",
  "border-toolbox-divider",
  "border-primary",
  "border-secondary",
  "border-tertiary",
  "border-white-alpha-14",
  "border-white-alpha-33",
  "text-primary",
  "text-secondary",
  "text-tertiary",
  "accent-primary",
  "accent-secondary",
  "accent-tertiary",
  "accent-warning",
  "btn-primary-bg",
  "btn-primary-text",
] as const;

export type ThemeVar = (typeof THEME_VARS)[number];
export type ThemePalette = Record<ThemeVar, string>;

export function buildThemePalette(def: ColorThemeDef): ThemePalette {
  const from = hexToHsl(def.accentFrom);
  const to = hexToHsl(def.accentTo);
  const hue = ((from.h % 360) + 360) % 360;
  const sat = clamp(from.s, 0, 100);

  if (def.mode === "dark") {
    const tSat = (fraction: number, min = 0, max = 100) =>
      clamp(Math.round(sat * fraction), min, max);

    const accentPrimary = hslToHex({ h: hue, s: clamp(from.s, 60, 96), l: clamp(from.l, 54, 68) });
    const accentSecondary = hslToHex({ h: to.h, s: clamp(to.s, 60, 96), l: clamp(to.l, 56, 70) });
    const accentTertiary = hslToHex({ h: to.h, s: clamp(to.s - 6, 40, 92), l: clamp(to.l + 10, 62, 78) });

    return {
      "bg-canvas": hslToHex({ h: hue, s: tSat(0.32, 4, 26), l: 3.2 }),
      "bg-surface": hslToHex({ h: hue, s: tSat(0.28, 3, 22), l: 5.5 }),
      "bg-primary": hslToHex({ h: hue, s: tSat(0.28, 3, 22), l: 5.5 }),
      "bg-elevated": hslToHex({ h: hue, s: tSat(0.24, 3, 20), l: 9 }),
      "bg-panel": hslToHex({ h: hue, s: tSat(0.24, 3, 20), l: 11 }),
      "bg-overlay": rgba(hslToRgb({ h: hue, s: 10, l: 6 }), 0.96),
      "bg-toolbox": "rgba(255, 255, 255, 0.04)",
      "bg-toolbox-active": "rgba(255, 255, 255, 0.09)",
      "bg-glass": "rgba(70, 70, 70, 0.2)",
      "border-toolbox-divider": "rgba(255, 255, 255, 0.1)",
      "border-primary": hslToHex({ h: hue, s: tSat(0.14, 2, 14), l: 10.5 }),
      "border-secondary": hslToHex({ h: hue, s: tSat(0.12, 2, 12), l: 12.5 }),
      "border-tertiary": hslToHex({ h: hue, s: tSat(0.1, 2, 10), l: 13.5 }),
      "border-white-alpha-14": "rgba(255, 255, 255, 0.08)",
      "border-white-alpha-33": "rgba(255, 255, 255, 0.2)",
      "text-primary": "#ffffff",
      "text-secondary": "rgba(255, 255, 255, 0.7)",
      "text-tertiary": "rgba(255, 255, 255, 0.45)",
      "accent-primary": accentPrimary,
      "accent-secondary": accentSecondary,
      "accent-tertiary": accentTertiary,
      "accent-warning": "#ffde9e",
      "btn-primary-bg": accentPrimary,
      "btn-primary-text": yiqBrightness(accentPrimary) >= 150 ? "#000000" : "#ffffff",
    };
  }

  // Light mode palette
  const lSat = (fraction: number, min: number, max: number) =>
    clamp(Math.round(sat * fraction), min, max);

  const accentPrimary = hslToHex({ h: hue, s: clamp(from.s, 58, 94), l: clamp(from.l, 40, 50) });
  const accentSecondary = hslToHex({ h: to.h, s: clamp(to.s, 52, 92), l: clamp(to.l, 44, 58) });
  const accentTertiary = hslToHex({ h: to.h, s: clamp(to.s - 6, 40, 88), l: clamp(to.l + 8, 48, 66) });

  return {
    "bg-canvas": hslToHex({ h: hue, s: lSat(0.5, 8, 50), l: 91.5 }),
    "bg-surface": "#ffffff",
    "bg-primary": hslToHex({ h: hue, s: lSat(0.45, 7, 45), l: 96 }),
    "bg-elevated": hslToHex({ h: hue, s: lSat(0.4, 6, 42), l: 92 }),
    "bg-panel": hslToHex({ h: hue, s: lSat(0.4, 6, 42), l: 89 }),
    "bg-overlay": "rgba(255, 255, 255, 0.96)",
    "bg-toolbox": "rgba(0, 0, 0, 0.04)",
    "bg-toolbox-active": "rgba(0, 0, 0, 0.08)",
    "bg-glass": "rgba(255, 255, 255, 0.55)",
    "border-toolbox-divider": "rgba(0, 0, 0, 0.1)",
    "border-primary": hslToHex({ h: hue, s: lSat(0.22, 5, 32), l: 90 }),
    "border-secondary": hslToHex({ h: hue, s: lSat(0.2, 5, 30), l: 84 }),
    "border-tertiary": hslToHex({ h: hue, s: lSat(0.16, 4, 24), l: 63 }),
    "border-white-alpha-14": "rgba(0, 0, 0, 0.06)",
    "border-white-alpha-33": "rgba(0, 0, 0, 0.14)",
    "text-primary": hslToHex({ h: hue, s: lSat(0.3, 6, 28), l: 10 }),
    "text-secondary": "rgba(0, 0, 0, 0.65)",
    "text-tertiary": "rgba(0, 0, 0, 0.45)",
    "accent-primary": accentPrimary,
    "accent-secondary": accentSecondary,
    "accent-tertiary": accentTertiary,
    "accent-warning": "#d97706",
    "btn-primary-bg": hslToHex({ h: hue, s: lSat(0.2, 4, 24), l: 13 }),
    "btn-primary-text": "#ffffff",
  };
}
