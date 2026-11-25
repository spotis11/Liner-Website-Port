export type LineAlign = "start" | "end" | "center";

export interface LyricToken {
  text: string;
  startMs: number;
  durationMs: number;
  background: boolean;
  space: boolean;
}

export interface LyricLineModel {
  startMs: number;
  durationMs: number;
  endMs: number;
  nextStartMs: number;
  align: LineAlign;
  rtl: boolean;
  instrumental: boolean;
  tokens: LyricToken[];
  subtitle: string | null;
  /** Timed tokens for the AI translation — copied from the original line's
   * windows (empty when the line has no translation or no timing). */
  subtitleTokens: LyricToken[];
  /** Direction of the SUBTITLE text itself (translation/romanization),
   * derived from its own script — never the line's. An Arabic song with an
   * English/Tagalog translation lays the subtitle LTR; an English song with
   * an Arabic translation lays it RTL. The canvas previously reused the
   * line's `rtl` here and mirrored Latin subtitles word-by-word (owner
   * report v1.35.4: Arabic songs "read backwards"). */
  subtitleRtl: boolean;
}

export interface LyricsModel {
  lines: LyricLineModel[];
  shiftMs: number;
}

export interface PlacedToken {
  token: LyricToken;
  x: number;
  baseline: number;
  width: number;
}

export interface PlacedText {
  text: string;
  x: number;
  baseline: number;
}

export interface LineLayout {
  line: LyricLineModel;
  top: number;
  height: number;
  tokens: PlacedToken[];
  subtitle: PlacedText[];
  /** Timed, placed translation tokens — karaoke-swept like the main text. */
  subtitleTokens: PlacedToken[];
}

export interface LyricsTypography {
  family: string;
  size: number;
  weight: number;
  lineHeight: number;
  paddingY: number;
  paddingX: number;
  /* ---- lyric style theme knobs (Settings → Lyrics) ---- */
  /** italic faces (Blur Italic) */
  italic?: boolean;
  /** force-uppercase lines (Headline, Drift, Bolt) */
  uppercase?: boolean;
  /** extra tracking between letters, px */
  letterSpacing?: number;
  /** extra gap between word groups, px (Spread) */
  spread?: number;
  /** fill color of sung text; null = engine white */
  activeColor?: string | null;
  /** two-stop gradient applied across each sung word */
  activeGradient?: [string, string];
  /** shadow color for glows; default active color */
  glowColor?: string;
  /** multiplies the word-sweep glow; 0 disables all glow */
  glowScale?: number;
  /** steady halo on sung text, rem */
  constantGlowRem?: number;
  /** opacity of lines that are not being sung; default 0.3 */
  inactiveAlpha?: number;
  /** gaussian blur on lines that are not being sung, px */
  inactiveBlurPx?: number;
  /** red/cyan fringe on sung text */
  glitch?: boolean;
}
