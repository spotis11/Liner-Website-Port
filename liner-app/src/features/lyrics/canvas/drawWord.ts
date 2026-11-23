import type { TokenHighlight } from "./timing";
import type { PlacedToken } from "./types";

export interface TokenPaint {
  ctx: CanvasRenderingContext2D;
  top: number;
  rtl: boolean;
  base: number;
  remPx: number;
  dpr: number;
  /* lyric style theme (Settings → Lyrics); all optional for tests/defaults */
  activeColor?: string | null;
  activeGradient?: [string, string];
  glowColor?: string;
  glowScale?: number;
  constantGlowRem?: number;
  glitch?: boolean;
}

export function white(alpha: number): string {
  return `rgba(255, 255, 255, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

const HEX_RGB = /^#([0-9a-f]{6})$/i;
const RGB_ALPHA = /^(rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+)(\s*,\s*([\d.]+))?\s*\)$/i;

/**
 * Re-write a CSS color's alpha channel — #rrggbb and rgb()/rgba() only, which
 * covers every color the lyric themes ship. Unparseable colors pass through
 * unchanged (their alpha then comes from the literal itself).
 */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const hex = HEX_RGB.exec(color);
  if (hex) {
    const value = parseInt(hex[1], 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
  }
  const rgb = RGB_ALPHA.exec(color);
  if (rgb) return `${rgb[1]}, ${a.toFixed(3)})`;
  return color;
}

function highlightStyle(
  paint: TokenPaint,
  placed: PlacedToken,
  highlight: TokenHighlight,
): string | CanvasGradient {
  const color = paint.activeColor || null;
  const gradientColors = paint.activeGradient;
  if (!color && !gradientColors && highlight.solid >= 1)
    return white(highlight.opacity);
  const width = Math.max(1, placed.width);
  const start = paint.rtl ? placed.x + width : placed.x;
  const end = paint.rtl ? placed.x : placed.x + width;
  const y = paint.top + placed.baseline;
  const gradient = paint.ctx.createLinearGradient(start, y, end, y);
  const solid = highlight.solid;
  const clear = highlight.clear + 1 / width;
  const alphaAt = (offset: number) =>
    highlight.opacity *
    Math.max(0, Math.min(1, (clear - offset) / Math.max(1e-6, clear - solid)));
  const at = (offset: number) => {
    if (gradientColors) {
      // gradient runs stop-to-stop across the word; the sweep still
      // controls visibility through per-stop alpha
      const t = Math.max(0, Math.min(1, offset));
      const mixed = mixColor(gradientColors[0], gradientColors[1], t);
      return withAlpha(mixed, alphaAt(offset));
    }
    if (color) return withAlpha(color, alphaAt(offset));
    return white(alphaAt(offset));
  };
  gradient.addColorStop(0, at(0));
  if (solid > 0 && solid < 1) gradient.addColorStop(solid, at(solid));
  if (clear > 0 && clear < 1) gradient.addColorStop(clear, withAlpha(gradientColors?.[1] ?? color ?? "#ffffff", 0));
  gradient.addColorStop(1, at(1));
  return gradient;
}

/** per-channel 8-bit mix of two #rrggbb colors (falls back to the first) */
function mixColor(a: string, b: string, t: number): string {
  const pa = HEX_RGB.exec(a);
  const pb = HEX_RGB.exec(b);
  if (!pa || !pb) return a;
  const va = parseInt(pa[1], 16);
  const vb = parseInt(pb[1], 16);
  const mix = (shift: number) => {
    const ca = (va >> shift) & 255;
    const cb = (vb >> shift) & 255;
    return Math.round(ca + (cb - ca) * t);
  };
  const r = mix(16);
  const g = mix(8);
  const bl = mix(0);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, "0")}`;
}

/** red/cyan fringe copies behind the sung text (Glitch) */
function drawGlitch(
  paint: TokenPaint,
  placed: PlacedToken,
  y: number,
  text: string,
) {
  const { ctx } = paint;
  const offset = Math.max(1, paint.remPx * 0.06) * paint.dpr;
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = "rgba(64, 220, 255, 0.9)";
  ctx.fillText(text, placed.x - offset, y);
  ctx.fillStyle = "rgba(255, 64, 96, 0.9)";
  ctx.fillText(text, placed.x + offset, y + offset * 0.5);
  ctx.restore();
}

export function drawToken(
  paint: TokenPaint,
  placed: PlacedToken,
  highlight: TokenHighlight | null,
) {
  const { ctx } = paint;
  const y = Math.round((paint.top + placed.baseline) * paint.dpr) / paint.dpr;
  const text = placed.token.text;
  ctx.fillStyle = white(paint.base);
  ctx.fillText(text, placed.x, y);
  if (!highlight || highlight.opacity <= 0) return;
  if (highlight.clear <= 0) return;
  const glowScale = paint.glowScale ?? 1;
  const constantGlow = (paint.constantGlowRem ?? 0) * paint.remPx * paint.dpr;
  const sweepGlow = highlight.glowRem * glowScale * paint.remPx * paint.dpr;
  if (paint.glitch) drawGlitch(paint, placed, y, text);
  ctx.fillStyle = highlightStyle(paint, placed, highlight);
  if (sweepGlow > 0 || constantGlow > 0) {
    ctx.save();
    ctx.shadowColor =
      paint.glowColor ?? paint.activeColor ?? paint.activeGradient?.[0] ?? white(1);
    ctx.shadowBlur = sweepGlow + constantGlow;
    ctx.fillText(text, placed.x, y);
    ctx.restore();
    return;
  }
  ctx.fillText(text, placed.x, y);
}
