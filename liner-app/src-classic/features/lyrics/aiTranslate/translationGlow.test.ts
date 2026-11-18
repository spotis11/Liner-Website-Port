import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startTranslationGlow } from "./translationGlow";
import type { Lyric } from "@braccato/parsers";

/**
 * The glow driver must flip `ai-tr--glow` exactly on the sung window of each
 * line, measured against the media clock — never early. These tests stub
 * requestAnimationFrame so every "frame" is deterministic.
 */

function buildLyrics(): Lyric[] {
  // Mirrors the E2E fixture: lines at 1s / 5s / 9s / 14s, durations implied
  // by the next line's start (no durationMs), except line 0 which ships one.
  return [
    { startTimeMs: 1000, durationMs: 3500, words: "one" },
    { startTimeMs: 5000, durationMs: 0, words: "two" },
    { startTimeMs: 9000, durationMs: 0, words: "three" },
    { startTimeMs: 14000, durationMs: 0, words: "four" },
  ];
}

function buildDom(lyrics: Lyric[]): HTMLElement {
  const root = document.createElement("div");
  lyrics.forEach((lyric, i) => {
    const line = document.createElement("div");
    line.className = "blyrics--line";
    line.dataset.lineNumber = String(i);
    const tr = document.createElement("div");
    tr.className = "blyrics--translated";
    tr.textContent = `t${i}`;
    line.appendChild(tr);
    root.appendChild(line);
  });
  return root;
}

describe("translationGlow", () => {
  let rafQueue: Array<(now: number) => void>;

  const frame = (now = performance.now()) => {
    const queue = rafQueue.splice(0);
    for (const cb of queue) cb(now);
  };

  beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal("requestAnimationFrame", (cb: (now: number) => void) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => vi.unstubAllGlobals());

  it("glows exactly from startTimeMs, not before", () => {
    const lyrics = buildLyrics();
    const root = buildDom(lyrics);
    let t = 0.4;
    const glow = startTranslationGlow(root, () => lyrics, () => t);

    frame();
    const trs = root.querySelectorAll<HTMLElement>(".blyrics--translated");
    expect(trs[0].classList.contains("ai-tr--glow")).toBe(false);

    t = 1.0; // line 0 starts
    frame();
    expect(trs[0].classList.contains("ai-tr--glow")).toBe(true);
    expect(trs[1].classList.contains("ai-tr--glow")).toBe(false);

    glow.stop();
  });

  it("hands the glow to the next line at its start and respects durationMs", () => {
    const lyrics = buildLyrics();
    const root = buildDom(lyrics);
    let t = 1.5;
    const glow = startTranslationGlow(root, () => lyrics, () => t);
    const trs = root.querySelectorAll<HTMLElement>(".blyrics--translated");

    frame();
    expect(trs[0].classList.contains("ai-tr--glow")).toBe(true);

    t = 4.4; // line 0's durationMs ends at 4.5 — still glowing
    frame();
    expect(trs[0].classList.contains("ai-tr--glow")).toBe(true);
    expect(trs[1].classList.contains("ai-tr--glow")).toBe(false);

    t = 4.6; // past durationMs, before next line — dark gap, like the engine
    frame();
    expect(trs[0].classList.contains("ai-tr--glow")).toBe(false);

    t = 5.0; // line 1 starts
    frame();
    expect(trs[1].classList.contains("ai-tr--glow")).toBe(true);
    expect(trs[0].classList.contains("ai-tr--glow")).toBe(false);

    glow.stop();
  });

  it("derives the end from the next line's start when durationMs is 0", () => {
    const lyrics = buildLyrics();
    const root = buildDom(lyrics);
    let t = 8.99;
    const glow = startTranslationGlow(root, () => lyrics, () => t);
    const trs = root.querySelectorAll<HTMLElement>(".blyrics--translated");

    frame();
    expect(trs[1].classList.contains("ai-tr--glow")).toBe(true);

    t = 9.0; // line 2 starts — line 1 must drop immediately
    frame();
    expect(trs[1].classList.contains("ai-tr--glow")).toBe(false);
    expect(trs[2].classList.contains("ai-tr--glow")).toBe(true);

    glow.stop();
  });

  it("keeps the last line glowing and survives DOM rebuilds", async () => {
    const lyrics = buildLyrics();
    const root = buildDom(lyrics);
    let t = 20;
    const glow = startTranslationGlow(root, () => lyrics, () => t);
    const trs = root.querySelectorAll<HTMLElement>(".blyrics--translated");

    frame();
    expect(trs[3].classList.contains("ai-tr--glow")).toBe(true);

    t = 120; // long past the last line — last sung line holds its glow
    frame();
    expect(trs[3].classList.contains("ai-tr--glow")).toBe(true);

    // braccato rebuilds the lines (track change): fresh nodes, no classes.
    // The driver learns about it through its MutationObserver — flush the
    // observer's microtask before the next frame.
    const fresh = buildDom(lyrics);
    root.replaceChildren(...Array.from(fresh.children));
    await Promise.resolve();
    frame();
    const freshTrs = root.querySelectorAll<HTMLElement>(".blyrics--translated");
    expect(freshTrs[3].classList.contains("ai-tr--glow")).toBe(true);

    glow.stop();
  });

  it("stops toggling after stop()", () => {
    const lyrics = buildLyrics();
    const root = buildDom(lyrics);
    let t = 0.4;
    const glow = startTranslationGlow(root, () => lyrics, () => t);
    frame();

    glow.stop();
    const queued = rafQueue.length;
    t = 6;
    frame();
    // no re-queue after stop → the frame ran empty
    expect(rafQueue.length).toBe(queued - 1);
    const trs = root.querySelectorAll<HTMLElement>(".blyrics--translated");
    expect(trs[1].classList.contains("ai-tr--glow")).toBe(false);
  });

  it("glows at the first sung word when the line start leads the vocal", () => {
    // Richsync sheets: providers stamp the LINE early so autoscroll lands
    // first, while the words light at their own part times. The translation
    // must follow the words — glowing at the line start was the "AI
    // translation isn't in song sync" report.
    const lyrics: Lyric[] = [
      {
        startTimeMs: 1000,
        durationMs: 4000,
        words: "lead in words",
        parts: [
          { startTimeMs: 1600, words: "lead", durationMs: 500 },
          { startTimeMs: 2100, words: "in", durationMs: 400 },
          { startTimeMs: 2500, words: "words", durationMs: 900 },
        ],
      },
      { startTimeMs: 7000, durationMs: 0, words: "next" },
    ] as unknown as Lyric[];
    const root = buildDom(lyrics);
    let t = 1.2; // line "active" (start 1.0) but first word only at 1.6
    const glow = startTranslationGlow(root, () => lyrics, () => t);
    const trs = root.querySelectorAll<HTMLElement>(".blyrics--translated");

    frame();
    expect(trs[0].classList.contains("ai-tr--glow")).toBe(false);

    t = 1.6; // first word's sweep begins
    frame();
    expect(trs[0].classList.contains("ai-tr--glow")).toBe(true);

    // the END edge is still the line's (1.0 + 4.0 = 5.0), not the last
    // word's (3.4) and not the next line's start (7.0): the engine keeps
    // sung words lit until the line exits
    t = 5.5; // past the line end → dark
    frame();
    expect(trs[0].classList.contains("ai-tr--glow")).toBe(false);

    glow.stop();
  });

  it("ignores background parts when picking the glow start", () => {
    const lyrics: Lyric[] = [
      {
        startTimeMs: 2000,
        durationMs: 3000,
        words: "choir echo lead vocal",
        parts: [
          { startTimeMs: 500, words: "choir", durationMs: 600, isBackground: true },
          { startTimeMs: 2000, words: "echo", durationMs: 400, isBackground: true },
          { startTimeMs: 2200, words: "lead vocal", durationMs: 1800 },
        ],
      },
    ] as unknown as Lyric[];
    const root = buildDom(lyrics);
    let t = 1.0; // background choir sings, lead vocal does not yet
    const glow = startTranslationGlow(root, () => lyrics, () => t);
    const trs = root.querySelectorAll<HTMLElement>(".blyrics--translated");

    frame();
    expect(trs[0].classList.contains("ai-tr--glow")).toBe(false);

    t = 2.2; // lead vocal starts
    frame();
    expect(trs[0].classList.contains("ai-tr--glow")).toBe(true);

    glow.stop();
  });

  it("does nothing when there is no media time yet", () => {
    const lyrics = buildLyrics();
    const root = buildDom(lyrics);
    const glow = startTranslationGlow(root, () => lyrics, () => null);
    frame();
    const trs = root.querySelectorAll<HTMLElement>(".blyrics--translated");
    for (const tr of trs) {
      expect(tr.classList.contains("ai-tr--glow")).toBe(false);
    }
    glow.stop();
  });
});
