import {
  backgroundFont,
  mainFont,
  SUBTITLE_GAP,
  SUBTITLE_SCALE,
  subtitleFont,
} from "./fonts";
import { layoutBlock, type BlockFrame } from "./layoutBlock";
import type { TextMeasure } from "./textMeasure";
import type {
  LineLayout,
  LyricLineModel,
  LyricToken,
  LyricsTypography,
  PlacedText,
  PlacedToken,
} from "./types";
import { alignOffset, rowExtents, wrapRuns, type Run } from "./wrapRuns";

export interface LayoutFrame extends BlockFrame {
  top: number;
}

function layoutSubtitleTimed(
  line: LyricLineModel,
  measure: TextMeasure,
  type: LyricsTypography,
  frame: LayoutFrame,
  top: number,
): { items: PlacedToken[]; rows: number } {
  const font = subtitleFont(type);
  // Group each timed word with its trailing spaces — the same run shape the
  // static path builds from `\S+\s*`.
  const wordRuns: { token: LyricToken; spaces: string }[] = [];
  for (const token of line.subtitleTokens) {
    if (token.space) {
      if (wordRuns.length > 0) wordRuns[wordRuns.length - 1].spaces += token.text;
      continue;
    }
    wordRuns.push({ token, spaces: "" });
  }
  const runs: Run[] = wordRuns.map((run) => ({
    width: measure.width(font, run.token.text + run.spaces),
    inkWidth: measure.width(font, run.token.text),
    breakAfter: true,
  }));
  const placed = wrapRuns(runs, frame.width);
  const extents = rowExtents(runs, placed);
  const align = line.rtl && line.align === "start" ? "end" : line.align;
  const rowHeight = type.size * SUBTITLE_SCALE * 1.3;
  const items = placed.map((item): PlacedToken => {
    const ink = runs[item.index].inkWidth;
    const rowWidth = extents[item.row];
    const logical = line.rtl ? rowWidth - item.x - ink : item.x;
    return {
      token: wordRuns[item.index].token,
      x: frame.left + alignOffset(align, rowWidth, frame.width) + logical,
      baseline: top + item.row * rowHeight + rowHeight * 0.78,
      width: ink,
    };
  });
  return { items, rows: extents.length };
}

function layoutSubtitle(
  line: LyricLineModel,
  measure: TextMeasure,
  type: LyricsTypography,
  frame: LayoutFrame,
  top: number,
): { items: PlacedText[]; timed: PlacedToken[]; rows: number } {
  if (line.subtitleTokens.length > 0 && line.subtitle) {
    const timed = layoutSubtitleTimed(line, measure, type, frame, top);
    return { items: [], timed: timed.items, rows: timed.rows };
  }
  if (!line.subtitle) return { items: [], timed: [], rows: 0 };
  const font = subtitleFont(type);
  const chunks = line.subtitle.match(/\S+\s*/g) ?? [];
  const runs: Run[] = chunks.map((chunk) => ({
    width: measure.width(font, chunk),
    inkWidth: measure.width(font, chunk.trimEnd()),
    breakAfter: true,
  }));
  const placed = wrapRuns(runs, frame.width);
  const extents = rowExtents(runs, placed);
  const align = line.rtl && line.align === "start" ? "end" : line.align;
  const rowHeight = type.size * SUBTITLE_SCALE * 1.3;
  const items = placed.map((item): PlacedText => {
    const ink = runs[item.index].inkWidth;
    const rowWidth = extents[item.row];
    const logical = line.rtl ? rowWidth - item.x - ink : item.x;
    return {
      text: chunks[item.index].trimEnd(),
      x: frame.left + alignOffset(align, rowWidth, frame.width) + logical,
      baseline: top + item.row * rowHeight + rowHeight * 0.78,
    };
  });
  return { items, timed: [], rows: extents.length };
}

function layoutSung(
  line: LyricLineModel,
  measure: TextMeasure,
  type: LyricsTypography,
  frame: LayoutFrame,
  top: number,
): LineLayout {
  const font = mainFont(type);
  const ascent = Math.round(measure.ascent(font));
  const descent = Math.round(measure.descent(font));
  const baselineInRow =
    Math.floor((type.lineHeight - ascent - descent) / 2) + ascent;
  const rowBaseline = (row: number) =>
    type.paddingY + row * type.lineHeight + baselineInRow;
  const main = layoutBlock(
    line,
    line.tokens.filter((token) => token.space || !token.background),
    font,
    measure,
    frame,
    rowBaseline,
  );
  const background = layoutBlock(
    line,
    line.tokens.filter((token) => token.space || token.background),
    backgroundFont(type),
    measure,
    frame,
    (row) => rowBaseline(main.rows + row),
  );
  const rows = main.rows + background.rows;
  const textBottom = type.paddingY + rows * type.lineHeight;
  const subtitle = layoutSubtitle(
    line,
    measure,
    type,
    frame,
    textBottom + SUBTITLE_GAP,
  );
  const subtitleHeight =
    subtitle.rows > 0
      ? SUBTITLE_GAP + subtitle.rows * type.size * SUBTITLE_SCALE * 1.3
      : 0;
  return {
    line,
    top,
    height: textBottom + subtitleHeight + type.paddingY,
    tokens: [...main.tokens, ...background.tokens],
    subtitle: subtitle.items,
    subtitleTokens: subtitle.timed,
  };
}

export function layoutLines(
  lines: LyricLineModel[],
  measure: TextMeasure,
  type: LyricsTypography,
  frame: LayoutFrame,
): LineLayout[] {
  let top = frame.top;
  return lines.map((line): LineLayout => {
    const layout = line.instrumental
      ? {
          line,
          top,
          height: type.paddingY * 2 + type.size,
          tokens: [],
          subtitle: [],
          subtitleTokens: [],
        }
      : layoutSung(line, measure, type, frame, top);
    top += layout.height;
    return layout;
  });
}
