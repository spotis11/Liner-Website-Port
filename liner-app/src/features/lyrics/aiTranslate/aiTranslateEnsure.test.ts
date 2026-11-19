import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./translate", () => ({
  providerIsReady: vi.fn(() => true),
  TranslationError: class TranslationError extends Error {},
  translateLines: vi.fn(),
}));

import { ensureTranslation, resetRetryStateForTests } from "./ensureTranslation";
import { translateLines } from "./translate";
import type { TranslateConfig } from "./translate";
import { useAiTranslateStore, translationCacheKey } from "./aiTranslateStore";

const mockedTranslate = vi.mocked(translateLines);

let seq = 0;
function freshTrack(): { track: string; key: string } {
  seq += 1;
  const track = `track-${seq}`;
  return { track, key: translationCacheKey(track, "liner", "en") };
}
const LINES = ["hola", "mundo"];
const CONFIG: TranslateConfig = { provider: "liner", targetLang: "en" };

function resetStore() {
  useAiTranslateStore.setState({
    enabled: true,
    autoTranslate: true,
    cache: {},
    manualTracks: {},
    pendingKey: null,
    lastError: null,
  });
  mockedTranslate.mockReset();
  resetRetryStateForTests();
}

describe("ensureTranslation pendingKey", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks background prefetches too — set at start, cleared on finish", async () => {
    const { track: TRACK, key: KEY } = freshTrack();
    // no reportErrors → this is the root prefetcher path; the button must
    // still see the load instead of claiming the translation is showing
    mockedTranslate.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          setTimeout(() => resolve(["hello", "world"]), 10);
        }),
    );
    ensureTranslation(TRACK, LINES, CONFIG);
    expect(useAiTranslateStore.getState().pendingKey).toBe(KEY);
    await vi.waitFor(() =>
      expect(useAiTranslateStore.getState().pendingKey).toBeNull(),
    );
    expect(useAiTranslateStore.getState().cache[KEY]?.lines).toEqual([
      "hello",
      "world",
    ]);
    expect(useAiTranslateStore.getState().lastError).toBeNull();
  });

  it("foreground failure surfaces the error and clears pendingKey", async () => {
    const { track: TRACK, key: KEY } = freshTrack();
    mockedTranslate.mockRejectedValueOnce(new Error("LLM down"));
    ensureTranslation(TRACK, LINES, CONFIG, { reportErrors: true });
    await vi.waitFor(() =>
      expect(useAiTranslateStore.getState().lastError).toBe("LLM down"),
    );
    expect(useAiTranslateStore.getState().pendingKey).toBeNull();
  });

  it("background failure stays silent and retries, then succeeds", async () => {
    const { track: TRACK, key: KEY } = freshTrack();
    vi.useFakeTimers();
    mockedTranslate
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(["hello", "world"]);
    ensureTranslation(TRACK, LINES, CONFIG);
    await vi.advanceTimersByTimeAsync(0);
    // silent: no error flash for a view the user has not opened
    expect(useAiTranslateStore.getState().lastError).toBeNull();
    // pendingKey released so the button does not hang on a dead fetch
    expect(useAiTranslateStore.getState().pendingKey).toBeNull();
    expect(mockedTranslate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(mockedTranslate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(useAiTranslateStore.getState().cache[KEY]?.lines).toEqual([
      "hello",
      "world",
    ]);
    expect(useAiTranslateStore.getState().pendingKey).toBeNull();
  });

  it("stops retrying after the bounded attempts", async () => {
    const { track: TRACK, key: KEY } = freshTrack();
    vi.useFakeTimers();
    mockedTranslate.mockRejectedValue(new Error("down"));
    ensureTranslation(TRACK, LINES, CONFIG);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mockedTranslate).toHaveBeenCalledTimes(3); // 1 + 2 retries
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockedTranslate).toHaveBeenCalledTimes(3);
  });

  it("clears a stale-length cache entry and refetches", async () => {
    const { track: TRACK, key: KEY } = freshTrack();
    // a provider switch mid-song left an entry aligned to a different lyric
    // set — it used to block every refetch forever
    useAiTranslateStore.setState({
      cache: { [KEY]: { lines: ["old", "entry", "extra"], at: 1 } },
    });
    mockedTranslate.mockResolvedValue(["hello", "world"]);
    ensureTranslation(TRACK, LINES, CONFIG);
    await vi.waitFor(() =>
      expect(useAiTranslateStore.getState().cache[KEY]?.lines).toEqual([
        "hello",
        "world",
      ]),
    );
    expect(mockedTranslate).toHaveBeenCalledTimes(1);
  });

  it("serves a matching cache entry without fetching", () => {
    const { track: TRACK, key: KEY } = freshTrack();
    useAiTranslateStore.setState({
      cache: { [KEY]: { lines: ["hello", "world"], at: 1 } },
    });
    ensureTranslation(TRACK, LINES, CONFIG);
    expect(mockedTranslate).not.toHaveBeenCalled();
    expect(useAiTranslateStore.getState().pendingKey).toBeNull();
  });
});
