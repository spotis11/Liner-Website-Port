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
}
