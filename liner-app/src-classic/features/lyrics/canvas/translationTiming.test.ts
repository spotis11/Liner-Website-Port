import { describe, it, expect } from "vitest";
import type { LyricPart, Lyric } from "@braccato/types";
import { lineSyncedParts } from "./tokens";
import { buildLines } from "./buildLines";
import { translationChunks, translationTokens } from "./translationTiming";

function part(words: string, startMs: number, durationMs: number): LyricPart {
  return { startTimeMs: startMs, words, durationMs };
}

describe("translationChunks", () => {
  it("splits sp languages into words", () => {
    expect(translationChunks("hola mundo")).toEqual(["hola", " ", "mundo"]);
  });

  it("splits unspaced scripts per character", () => {
    const chunks = translationChunks("世界こんにちは");
    expect(chunks).toHaveLength(7);
    expect(chunks[0]).toBe("世");
    expect(chunks[6]).toBe("は");
  });

  it("keeps latin words whole inside mixed runs", () => {
    // no CJK in the run → stays one word
    expect(translationChunks("hello")).toEqual(["hello"]);
  });
});

describe("translationTokens", () => {
  it("copies word-level richsync windows onto translated words", () => {
    // original line sings 3 words in 3 windows (like polaris mono parts)
    const parts = [
      part("yeah", 1000, 1000),
      part("baby", 2000, 1000),
      part("keep it real", 3000, 2000),
    ];
    const tokens = translationTokens(parts, "sí bebé mantén la verdad");
    const words = tokens.filter((token) => !token.space);
    expect(words).toHaveLength(5);
    // every token carries a real window inside its part's span
    for (const token of words) {
      expect(token.durationMs).toBeGreaterThan(0);
      expect(token.startMs).toBeGreaterThanOrEqual(1000);
      expect(token.startMs + token.durationMs).toBeLessThanOrEqual(5000);
    }
    // first chunk starts when the line starts; last ends with the line
    expect(words[0].startMs).toBe(1000);
    expect(words[4].startMs + words[4].durationMs).toBe(5000);
    // windows are strictly ordered — the sweep never goes backwards
    for (let i = 1; i < words.length; i += 1) {
      expect(words[i].startMs).toBeGreaterThanOrEqual(
        words[i - 1].startMs + words[i - 1].durationMs,
      );
    }
  });

  it("copies the line-synced proportional split for LRC lines", () => {
    const parts = lineSyncedParts("hello world how are you", 0, 4000);
    const tokens = translationTokens(parts, "hola mundo cómo estás");
    const words = tokens.filter((token) => !token.space);
    expect(words.length).toBeGreaterThan(0);
    for (const token of words) {
      expect(token.durationMs).toBeGreaterThan(0);
    }
    expect(words[0].startMs).toBe(0);
    const last = words[words.length - 1];
    expect(last.startMs + last.durationMs).toBeLessThanOrEqual(4000);
  });

  it("maps per-character timing for unspaced translations", () => {
    const parts = [part("na na", 1000, 2000)];
    const tokens = translationTokens(parts, "啦啦啦啦");
    const words = tokens.filter((token) => !token.space);
    expect(words).toHaveLength(4);
    // each character gets an equal slice of the window
    expect(words[0].startMs).toBe(1000);
    expect(words[0].durationMs).toBe(500);
    expect(words[3].startMs).toBe(2500);
    expect(words[3].durationMs).toBe(500);
  });

  it("gives a long first word more translation than a short one", () => {
    const parts = [part("extraordinarily", 0, 1000), part("go", 1000, 1000)];
    const tokens = translationTokens(
      parts,
      "extra largo corto fin", // 4 words
    );
    const words = tokens.filter((token) => !token.space);
    expect(words.length).toBe(4);
    // first part holds 11/17 of the letters → 2-3 words, second part the rest
    const firstWindow = words.filter((word) => word.startMs < 1000);
    expect(firstWindow.length).toBeGreaterThanOrEqual(1);
    expect(firstWindow.length).toBeLessThanOrEqual(3);
  });

  it("returns [] when the original line has no timed parts", () => {
    const parts = [part("plain", 0, 0)];
    expect(translationTokens(parts, "llano")).toEqual([]);
  });

  it("returns [] for an empty translation", () => {
    expect(translationTokens([part("hi", 0, 500)], "")).toEqual([]);
    expect(translationTokens([part("hi", 0, 500)], "   ")).toEqual([]);
  });

  it("drops zero-duration and whitespace-only parts from the mapping", () => {
    const parts = [
      part(" ", 0, 500),
      part("sung", 0, 1000),
      part("", 1000, 1000),
    ];
    const tokens = translationTokens(parts, "cantada");
    const words = tokens.filter((token) => !token.space);
    expect(words).toHaveLength(1);
    expect(words[0].startMs).toBe(0);
    expect(words[0].durationMs).toBe(1000);
  });

  it("keeps space tokens between timed words", () => {
    const tokens = translationTokens([part("hi there", 0, 1000)], "hola ahí");
    expect(tokens.some((token) => token.space)).toBe(true);
    for (const token of tokens.filter((t) => t.space)) {
      expect(token.durationMs).toBe(0);
    }
  });
});

describe("buildLines with translation", () => {
  it("attaches timed subtitle tokens copied from richsync parts", () => {
    const lyrics: Lyric[] = [
      {
        startTimeMs: 1000,
        durationMs: 4000,
        words: "yeah baby keep it real",
        parts: [
          part("yeah", 1000, 1000),
          part("baby", 2000, 1000),
          part("keep it real", 3000, 2000),
        ],
        translation: { text: "sí bebé mantén la verdad", lang: "es" },
      },
    ];
    const model = buildLines(lyrics);
    expect(model.lines[0].subtitle).toBe("sí bebé mantén la verdad");
    const words = model.lines[0].subtitleTokens.filter((t) => !t.space);
    expect(words.length).toBe(5);
    expect(words[0].startMs).toBe(1000);
    for (const token of words) {
      expect(token.durationMs).toBeGreaterThan(0);
    }
  });

  it("synthesizes the line window for LRC lines before copying", () => {
    const lyrics: Lyric[] = [
      {
        startTimeMs: 500,
        durationMs: 0,
        words: "one two three",
        translation: { text: "uno dos tres", lang: "es" },
      },
      { startTimeMs: 3500, durationMs: 0, words: "next" },
    ];
    const model = buildLines(lyrics);
    const tokens = model.lines[0].subtitleTokens.filter((t) => !t.space);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0].startMs).toBe(500);
    for (const token of tokens) {
      expect(token.durationMs).toBeGreaterThan(0);
      expect(token.startMs).toBeLessThan(3500);
    }
  });

  it("leaves subtitleTokens empty for romanization-only lines", () => {
    const lyrics: Lyric[] = [
      {
        startTimeMs: 0,
        durationMs: 1000,
        words: "sayonara",
        romanization: "sayonara",
      },
    ];
    const model = buildLines(lyrics);
    expect(model.lines[0].subtitle).toBe("sayonara");
    expect(model.lines[0].subtitleTokens).toEqual([]);
  });
});
