import { describe, it, expect } from "vitest";
import { isTranslatableLine } from "./translate";
import { AI_PROVIDERS, getProviderDef } from "./providers";
import { translationCacheKey, resolveModel } from "./aiTranslateStore";

describe("ai translate providers", () => {
  it("registers the six desktop providers with Google free", () => {
    const ids = AI_PROVIDERS.map((p) => p.id);
    expect(ids).toEqual([
      "google",
      "openrouter",
      "gemini",
      "openai",
      "claude",
      "ollama",
    ]);
    expect(getProviderDef("google").free).toBe(true);
    expect(getProviderDef("google").needsKey).toBe(false);
    expect(getProviderDef("openai").needsKey).toBe(true);
  });

  it("falls back to the default model when no override is set", () => {
    expect(resolveModel("openai", {})).toBe(getProviderDef("openai").defaultModel);
    expect(resolveModel("openai", { openai: "gpt-4.1-mini" })).toBe("gpt-4.1-mini");
  });
});

describe("cache keys", () => {
  it("separates tracks, providers and languages", () => {
    const key = translationCacheKey("track-1", "google", "en");
    expect(key).toBe("track-1::google::en");
    expect(translationCacheKey("track-1", "google", "ja")).not.toBe(key);
    expect(translationCacheKey("track-1", "openai", "en")).not.toBe(key);
  });
});

describe("isTranslatableLine", () => {
  it("skips blank and music-only lines", () => {
    expect(isTranslatableLine("")).toBe(false);
    expect(isTranslatableLine("   ")).toBe(false);
    expect(isTranslatableLine("♪")).toBe(false);
    expect(isTranslatableLine("♫ ♪")).toBe(false);
    expect(isTranslatableLine("(Instrumental)")).toBe(false);
  });

  it("keeps real lyric lines", () => {
    expect(isTranslatableLine("引き抜くカセット")).toBe(true);
    expect(isTranslatableLine("Hello world")).toBe(true);
    expect(isTranslatableLine("'Cause you're scared and you're not talking")).toBe(true);
  });
});
