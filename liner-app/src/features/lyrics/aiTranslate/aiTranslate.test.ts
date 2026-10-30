import { describe, it, expect, vi, afterEach } from "vitest";
import { isTranslatableLine, translateLines } from "./translate";
import { AI_PROVIDERS, getProviderDef } from "./providers";
import { translationCacheKey, resolveModel } from "./aiTranslateStore";

describe("ai translate providers", () => {
  it("registers the built-in + desktop providers, free ones first", () => {
    const ids = AI_PROVIDERS.map((p) => p.id);
    expect(ids).toEqual([
      "liner",
      "google",
      "openrouter",
      "gemini",
      "openai",
      "claude",
      "ollama",
    ]);
    expect(getProviderDef("liner").free).toBe(true);
    expect(getProviderDef("liner").needsKey).toBe(false);
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

describe("translateLines error surfacing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws when a chat model answer is unreadable instead of silently returning the original lines", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Sorry, I cannot answer that." } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    await expect(
      translateLines(["A song line"], {
        provider: "openrouter",
        targetLang: "en",
        apiKey: "sk-or-v1-test",
      }),
    ).rejects.toThrow(/unreadable/i);
  });

  it("returns aligned translations when the model answers with a JSON array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '["Una línea de canción"]' } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const out = await translateLines(["A song line"], {
      provider: "openrouter",
      targetLang: "es",
      apiKey: "sk-or-v1-test",
    });
    expect(out).toEqual(["Una línea de canción"]);
  });
});

describe("provider default models stay current", () => {
  it("does not ship retired model slugs as defaults", () => {
    // google/gemini-2.0-flash-001 was delisted from OpenRouter — every
    // translation through the default failed with 404 model-not-found
    const retired = ["gemini-2.0-flash-001", "gemini-2.0-flash", "gpt-4o-mini", "claude-3-5-haiku"];
    for (const p of AI_PROVIDERS) {
      if (!p.defaultModel) continue;
      for (const slug of retired) {
        expect(p.defaultModel).not.toContain(slug);
      }
    }
  });
});
