import { drawToken, white } from "./drawWord";
import { backgroundFont, mainFont, subtitleFont } from "./fonts";
import { tokenHighlight } from "./timing";
import type { LineLayout, LyricsTypography } from "./types";

const DEFAULT_INACTIVE_ALPHA = 0.3;
const SUBTITLE_ALPHA = 0.6;
const REM_PX = 16;

/** ctx.letterSpacing may be missing in older lib.dom typings */
function setLetterSpacing(
  ctx: CanvasRenderingContext2D,
  px: number | undefined,
) {
  const spaced = ctx as CanvasRenderingContext2D & {
    letterSpacing?: string;
  };
  try {
    spaced.letterSpacing = px ? `${px}px` : "0px";
  } catch {
    // engine without letterSpacing support — tracking is simply lost
  }
}

export function drawLine(
  ctx: CanvasRenderingContext2D,
  layout: LineLayout,
  top: number,
  timeMs: number,
  type: LyricsTypography,
  dpr: number,
  now: number,
) {
  const { line } = layout;
  ctx.direction = line.rtl ? "rtl" : "ltr";
  setLetterSpacing(ctx, type.letterSpacing);
  const inactiveAlpha = type.inactiveAlpha ?? DEFAULT_INACTIVE_ALPHA;
  const backgroundAlpha = inactiveAlpha * 0.78;
  let current = "";
  for (const placed of layout.tokens) {
    const background = placed.token.background;
    const font = background ? backgroundFont(type) : mainFont(type);
    if (font !== current) {
      current = font;
      ctx.font = font;
    }
    drawToken(
      {
        ctx,
        top,
        rtl: line.rtl,
        base: background ? backgroundAlpha : inactiveAlpha,
        remPx: REM_PX,
        dpr,
        activeColor: type.activeColor,
        activeGradient: type.activeGradient,
        glowColor: type.glowColor,
        glowScale: type.glowScale,
        constantGlowRem: type.constantGlowRem,
        glitch: type.glitch,
      },
      placed,
      tokenHighlight(placed.token, line, timeMs, now),
    );
  }
  if (layout.subtitleTokens.length > 0) {
    // Karaoke sweep on the AI translation — same per-token highlight the
    // main words get, in the windows copied from the original line. The
    // base direction (and the sweep's start/end orientation) follows the
    // SUBTITLE's own script, not the line's — a Latin translation under an
    // Arabic line draws LTR with an LTR sweep.
    ctx.direction = line.subtitleRtl ? "rtl" : "ltr";
    ctx.font = subtitleFont(type);
    for (const placed of layout.subtitleTokens) {
      drawToken(
        {
          ctx,
          top,
          rtl: line.subtitleRtl,
          base: SUBTITLE_ALPHA,
          remPx: REM_PX,
          dpr,
          activeColor: type.activeColor,
          activeGradient: type.activeGradient,
          glowColor: type.glowColor,
          glowScale: type.glowScale,
          constantGlowRem: type.constantGlowRem,
          glitch: type.glitch,
        },
        placed,
        tokenHighlight(placed.token, line, timeMs, now),
      );
    }
    return;
  }
  if (layout.subtitle.length === 0) return;
  ctx.direction = line.subtitleRtl ? "rtl" : "ltr";
  ctx.font = subtitleFont(type);
  ctx.fillStyle = white(SUBTITLE_ALPHA);
  for (const text of layout.subtitle) {
    ctx.fillText(
      text.text,
      text.x,
      Math.round((top + text.baseline) * dpr) / dpr,
    );
  }
}
