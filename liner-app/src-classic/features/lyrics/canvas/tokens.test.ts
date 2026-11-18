import { describe, it, expect } from "vitest";
import { lineSyncedParts } from "./tokens";

describe("lineSyncedParts", () => {
  it("distributes the line duration across words by character count", () => {
    const parts = lineSyncedParts("hello world test", 1000, 4000);
    // 3 words, 13 letters total (hello=5, world=5, test=4)
    // span = 3000ms, distributed by char count
    const words = parts.filter((p) => p.words.trim());
    expect(words).toHaveLength(3);

    // Each word should have a real duration > 0 (activates the sweep branch)
    for (const w of words) {
      expect(w.durationMs).toBeGreaterThan(0);
    }

    // First word starts at line start
    expect(words[0].startTimeMs).toBe(1000);
    // Words are in order
    expect(words[0].words).toBe("hello");
    expect(words[1].words).toBe("world");
    expect(words[2].words).toBe("test");
    // Last word ends at or before line end
    const lastEnd = words[2].startTimeMs + words[2].durationMs;
    expect(lastEnd).toBeLessThanOrEqual(4000);
  });

  it("assigns durationMs 0 to whitespace chunks", () => {
    const parts = lineSyncedParts("hi there", 0, 2000);
    const spaces = parts.filter((p) => /^\s+$/.test(p.words));
    expect(spaces.length).toBeGreaterThan(0);
    for (const s of spaces) {
      expect(s.durationMs).toBe(0);
    }
  });

  it("handles a single-word line", () => {
    const parts = lineSyncedParts("alone", 500, 2500);
    const words = parts.filter((p) => p.words.trim());
    expect(words).toHaveLength(1);
    expect(words[0].durationMs).toBeGreaterThan(0);
    expect(words[0].startTimeMs).toBe(500);
  });

  it("produces durationMs > 0 so the renderer takes the sweep branch", () => {
    // This is the critical assertion: without real durations, timing.ts
    // falls back to the uniform-fade branch (no word-by-word sweep).
    const parts = lineSyncedParts("cause no one cares about me", 0, 5000);
    const words = parts.filter((p) => p.words.trim());
    for (const w of words) {
      expect(w.durationMs).toBeGreaterThan(0);
    }
  });

  it("handles empty or whitespace-only text gracefully", () => {
    const parts = lineSyncedParts("", 0, 1000);
    expect(parts).toHaveLength(0);
    const spaces = lineSyncedParts("   ", 0, 1000);
    for (const s of spaces) {
      expect(s.durationMs).toBe(0);
    }
  });
});
