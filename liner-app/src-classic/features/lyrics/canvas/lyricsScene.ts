import type { Lyric } from "@braccato/parsers";
import { buildLines } from "./buildLines";
import { LYRICS_TYPOGRAPHY, loadLyricsFonts, resolveFamily } from "./fonts";
import { layoutLines, type LayoutFrame } from "./layoutLines";
import { createTextMeasure, type TextMeasure } from "./textMeasure";
import { maxScrollFor } from "./scrollPlan";
import type {
  LineLayout,
  LyricLineModel,
  LyricsModel,
  LyricsTypography,
} from "./types";

const SIDE_INSET = 24;
const TOP_INSET = 32;

/** force-uppercase token text (Headline / Drift / Bolt styles) */
function uppercaseModel(model: LyricsModel): LyricLineModel[] {
  const upper = (text: string) =>
    text ? text.toLocaleUpperCase() : text;
  return model.lines.map((line) => ({
    ...line,
    tokens: line.tokens.map((token) =>
      token.space ? token : { ...token, text: upper(token.text) },
    ),
    subtitle: line.subtitle ? upper(line.subtitle) : line.subtitle,
    subtitleTokens: line.subtitleTokens.map((token) =>
      token.space ? token : { ...token, text: upper(token.text) },
    ),
  }));
}

export class LyricsScene {
  lines: LyricLineModel[] = [];
  shiftMs = 0;
  layouts: LineLayout[] = [];
  width = 0;
  height = 0;
  typography: LyricsTypography = LYRICS_TYPOGRAPHY;
  measure: TextMeasure;
  version = 0;
  private rawLines: LyricLineModel[] = [];

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    host: Element,
    private readonly onFontsReady: () => void,
  ) {
    this.typography = { ...LYRICS_TYPOGRAPHY, family: resolveFamily(host) };
    this.measure = createTextMeasure(ctx);
    document.fonts?.addEventListener("loadingdone", this.remeasure);
    void loadLyricsFonts(this.typography).then(this.remeasure);
  }

  private readonly remeasure = () => {
    this.measure = createTextMeasure(
      this.ctx,
      this.typography.letterSpacing ?? 0,
    );
    this.relayout();
    this.onFontsReady();
  };

  dispose() {
    document.fonts?.removeEventListener("loadingdone", this.remeasure);
  }

  get frame(): LayoutFrame {
    const left = SIDE_INSET + this.typography.paddingX;
    return { left, width: Math.max(1, this.width - left * 2), top: TOP_INSET };
  }

  setLyrics(lyrics: Lyric[]) {
    const model = buildLines(lyrics);
    this.rawLines = model.lines;
    this.shiftMs = model.shiftMs;
    this.applyTypography();
    const text = lyrics.map((line) => line.words ?? "").join("\n");
    void loadLyricsFonts(this.typography, text);
  }

  /**
   * Apply a lyric style theme (Settings → Lyrics). Empty family keeps the
   * host-resolved Montserrat family. Re-measures with the style's letter
   * spacing, re-cases the text and re-layouts — line bitmaps rebuild
   * automatically because their cache keys carry scene.version.
   */
  setTypography(next: LyricsTypography) {
    this.typography = {
      ...next,
      family: next.family || this.typography.family,
    };
    this.measure = createTextMeasure(
      this.ctx,
      this.typography.letterSpacing ?? 0,
    );
    this.applyTypography();
    const sample = this.rawLines
      .map((line) => line.tokens.map((token) => token.text).join(""))
      .join("\n");
    void loadLyricsFonts(this.typography, sample);
  }

  private applyTypography() {
    this.lines = this.typography.uppercase
      ? uppercaseModel({ lines: this.rawLines, shiftMs: this.shiftMs })
      : this.rawLines;
    this.relayout();
  }

  setSize(width: number, height: number) {
    const widthChanged = width !== this.width;
    this.width = width;
    this.height = height;
    if (widthChanged) this.relayout();
  }

  relayout() {
    this.version += 1;
    this.layouts =
      this.width > 0
        ? layoutLines(this.lines, this.measure, this.typography, this.frame)
        : [];
  }

  maxScroll(): number {
    return maxScrollFor(this.layouts, this.height);
  }

  lineAt(y: number, scroll: number): number | null {
    const contentY = y + scroll;
    const index = this.layouts.findIndex(
      (layout) =>
        contentY >= layout.top && contentY < layout.top + layout.height,
    );
    return index >= 0 ? index : null;
  }
}
