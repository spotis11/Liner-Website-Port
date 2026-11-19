import type { LyricPart } from "@braccato/parsers";
import type { LyricToken } from "./types";

const SPACE = /^\s+$/u;

// Scripts written without spaces between words (CJK, Thai, Lao, Khmer,
// Myanmar). A translated line in these scripts would otherwise collapse
// into one token per run and the sweep would have nothing to move across —
// split those runs per character so each gets its own slice of the line's
// timing, the way syllable-level lyrics light up.
const UNSPACED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

export function translationChunks(text: string): string[] {
  const chunks: string[] = [];
  for (const run of text.match(/\s+|[^\s]+/gu) ?? []) {
    if (SPACE.test(run) || !UNSPACED.test(run)) {
      chunks.push(run);
      continue;
    }
    for (const char of run) chunks.push(char);
  }
  return chunks;
}

/**
 * Build timed tokens for a translated line by COPYING the original line's
 * timing structure. `parts` are the exact windows the main tokens use —
 * real word-level parts from richsync providers, or the line window split
 * proportionally by lineSyncedParts for line-synced LRC. The translated
 * words are mapped onto those windows proportional to each part's share of
 * the original letters, so the translation highlights word-by-word in the
 * same rhythm the original is sung — whichever lyrics provider supplied the
 * timing and whichever AI provider produced the translation.
 *
 * Returns [] when there is nothing to time against (no timed parts, or no
 * translated words) — the caller keeps its static subtitle fallback.
 */
export function translationTokens(
  parts: LyricPart[],
  translatedText: string,
): LyricToken[] {
  const chunks = translationChunks(translatedText);
  const wordCount = chunks.filter((chunk) => !SPACE.test(chunk)).length;
  const timed = parts.filter(
    (part) => part.durationMs > 0 && /\S/u.test(part.words),
  );
  if (wordCount === 0 || timed.length === 0) return [];

  // Integer word counts per part: largest-remainder rounding of each part's
  // letter share of the translated word total.
  const letters = timed.map(
    (part) =>
      (part.words.match(/\S+/gu) ?? []).reduce(
        (sum, word) => sum + word.length,
        0,
      ),
  );
  const totalLetters = letters.reduce((sum, count) => sum + count, 0);
  const ideal = letters.map((count) => (count / totalLetters) * wordCount);
  const counts = ideal.map((value) => Math.floor(value));
  let leftover = wordCount - counts.reduce((sum, count) => sum + count, 0);
  const order = ideal
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (let i = 0; leftover > 0; i += 1, leftover -= 1) {
    counts[order[i % order.length].index] += 1;
  }
  // With enough words, no timed part may sit empty — borrow from the
  // largest group so every window keeps at least one word.
  if (wordCount >= timed.length) {
    for (let k = 0; k < counts.length; k += 1) {
      if (counts[k] === 0) {
        const donor = counts.indexOf(Math.max(...counts));
        if (counts[donor] > 1) {
          counts[donor] -= 1;
          counts[k] += 1;
        }
      }
    }
  }

  const tokens: LyricToken[] = [];
  let chunkIndex = 0;
  timed.forEach((part, partIndex) => {
    // Take `counts[partIndex]` word chunks, keeping whitespace runs between
    // them (a run after the group's last word becomes the next group's
    // leading separator — space tokens carry no timing).
    const group: string[] = [];
    let taken = 0;
    while (chunkIndex < chunks.length && taken < counts[partIndex]) {
      const chunk = chunks[chunkIndex];
      chunkIndex += 1;
      group.push(chunk);
      if (!SPACE.test(chunk)) taken += 1;
    }

    const groupLetters = group
      .filter((chunk) => !SPACE.test(chunk))
      .reduce((sum, chunk) => sum + chunk.length, 0);
    const at = (offset: number) =>
      part.startTimeMs +
      Math.round((part.durationMs * offset) / Math.max(1, groupLetters));
    let cursor = 0;
    for (const chunk of group) {
      if (SPACE.test(chunk)) {
        tokens.push({
          text: chunk,
          startMs: 0,
          durationMs: 0,
          background: false,
          space: true,
        });
        continue;
      }
      const startMs = at(cursor);
      cursor += chunk.length;
      tokens.push({
        text: chunk,
        startMs,
        durationMs: Math.max(0, at(cursor) - startMs),
        background: false,
        space: false,
      });
    }
  });
  return tokens;
}
