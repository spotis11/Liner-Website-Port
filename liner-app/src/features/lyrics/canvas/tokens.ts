import type { LyricPart } from "@braccato/parsers";
import type { LyricToken } from "./types";

const SPACE = /^\s+$/u;

export interface WordGroup {
  background: boolean;
  tokens: LyricToken[];
}

export type LineItem = WordGroup | LyricToken;

function splitPart(part: LyricPart): LyricToken[] {
  const chunks = part.words.match(/\s+|\S+/gu) ?? [];
  const letters = chunks
    .filter((chunk) => !SPACE.test(chunk))
    .reduce((total, chunk) => total + chunk.length, 0);
  let cursor = 0;
  return chunks.map((chunk): LyricToken => {
    const background = part.isBackground === true;
    if (SPACE.test(chunk)) {
      return {
        text: chunk,
        startMs: 0,
        durationMs: 0,
        background,
        space: true,
      };
    }
    const at = (offset: number) =>
      part.startTimeMs + Math.round((part.durationMs * offset) / letters);
    const startMs = at(cursor);
    cursor += chunk.length;
    return {
      text: chunk,
      startMs,
      durationMs: at(cursor) - startMs,
      background,
      space: false,
    };
  });
}

/**
 * Synthesize per-word LyricParts from a line-level LRC entry (which has only
 * a line start timestamp, no word timings). The line's [startMs, endMs] window
 * is distributed across words proportional to character count, giving each
 * word a real durationMs > 0. This activates the renderer's per-word gradient
 * sweep (drawWord.ts → timing.ts sweepAt branch) — the same visual effect the
 * desktop gets from its "polaris mono" word-level provider, without needing
 * access to that private backend.
 *
 * Previously this gave every word durationMs: 0 with a fixed 50 ms gap, which
 * made timing.ts take its uniform-fade branch — the user saw a static
 * line-by-line highlight instead of a word-by-word sweep.
 */
export function lineSyncedParts(
  text: string,
  startMs: number,
  endMs: number,
): LyricPart[] {
  const span = Math.max(0, endMs - startMs);
  const chunks = text.match(/\s+|\S+/gu) ?? [];
  const letters = chunks
    .filter((chunk) => !SPACE.test(chunk))
    .reduce((total, chunk) => total + chunk.length, 0);
  let cursor = 0;
  return chunks.map((chunk): LyricPart => {
    if (SPACE.test(chunk)) {
      return { startTimeMs: startMs, words: chunk, durationMs: 0 };
    }
    const at = (offset: number) =>
      startMs + Math.round((span * offset) / Math.max(1, letters));
    const wordStart = at(cursor);
    cursor += chunk.length;
    const wordEnd = at(cursor);
    return {
      startTimeMs: wordStart,
      words: chunk,
      durationMs: Math.max(0, wordEnd - wordStart),
    };
  });
}

export function tokenize(parts: LyricPart[]): LyricToken[] {
  return parts.flatMap(splitPart);
}

export function groupTokens(tokens: LyricToken[]): LineItem[] {
  const items: LineItem[] = [];
  let current: WordGroup | null = null;
  for (const token of tokens) {
    if (token.space) {
      current = null;
      items.push(token);
      continue;
    }
    if (!current || current.background !== token.background) {
      current = { background: token.background, tokens: [] };
      items.push(current);
    }
    current.tokens.push(token);
  }
  return items;
}

export function isGroup(item: LineItem): item is WordGroup {
  return "tokens" in item;
}
