import { describe, it, expect, beforeEach, vi } from "vitest";

const { getAuthSession, getValidAccessToken } = vi.hoisted(() => ({
  getAuthSession: vi.fn(),
  getValidAccessToken: vi.fn(),
}));

vi.mock("@/shared/api/auth-session", () => ({
  getAuthSession,
  getValidAccessToken,
}));

vi.mock("@/shared/api/baseUrl", () => ({
  getApiBaseUrl: () => "https://api.tryliner.fun",
}));

import {
  markLinerStreamFailed,
  resetLinerPlaybackPause,
  resolveLinerStream,
} from "./linerPlayback";

beforeEach(() => {
  vi.clearAllMocks();
  resetLinerPlaybackPause();
  getAuthSession.mockReturnValue({ accessToken: "token" });
  getValidAccessToken.mockResolvedValue("token");
});

describe("liner r2 cache probe", () => {
  it("returns the presigned stream when the api answers ok", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            url: "https://r2.example/presigned",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            mimeType: "audio/webm",
            size: 1_000,
          }),
          { status: 200 },
        ),
      );

    const stream = await resolveLinerStream("dQw4w9WgXcQ");

    expect(stream?.url).toBe("https://r2.example/presigned");
    expect(fetchSpy).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });

  it("pauses every r2 lookup after a dead r2 stream (markLinerStreamFailed)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    markLinerStreamFailed("media error 4");

    expect(await resolveLinerStream("dQw4w9WgXcQ")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    // the pause expires and the probe resumes (mock answers 200 -> parsed body)
    resetLinerPlaybackPause();
    expect(await resolveLinerStream("dQw4w9WgXcQ")).toEqual({});
    expect(fetchSpy).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});
