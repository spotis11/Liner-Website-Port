import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "@/shared/contracts";
import type { Track } from "@/shared/types";

const mocks = vi.hoisted(() => ({
  resolveDirectAudioStream: vi.fn(),
  searchRaw: vi.fn(),
  resolveSoundCloudStream: vi.fn(),
}));

vi.mock("@/shared/youtube", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/youtube")>();
  return {
    ...actual,
    resolveDirectAudioStream: mocks.resolveDirectAudioStream,
    searchRaw: mocks.searchRaw,
  };
});

vi.mock("@/shared/media/soundcloud/soundcloudCatalogRequest", () => ({
  getJson: vi.fn().mockRejectedValue(new Error("soundcloud offline")),
}));

vi.mock("@/shared/media/soundcloud", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/shared/media/soundcloud")>();
  return { ...actual, resolveSoundCloudStream: mocks.resolveSoundCloudStream };
});

import { resolvePlaybackStream } from "./streamResolver";
import { clearYoutubeStandInCache } from "./youtubeStandIn";
import { usePlayerStore } from "../store/playerStore";
import { getJson } from "@/shared/media/soundcloud/soundcloudCatalogRequest";

const directStream = {
  url: "https://rr1.googlevideo.com/videoplayback?itag=251",
  mimeType: "audio/webm",
  codec: "opus" as const,
  bitrate: 135_000,
  itag: 251,
  expiresAt: "2030-01-01T00:00:00.000Z",
};

function track(
  id: string,
  title = "Blinding Lights",
  artists = "The Weeknd",
  durationMs = 200_000,
): Track {
  return { id, title, artists, durationMs, coverUrl: "", playCount: 0 };
}

function searchTrack(
  id: string,
  title: string,
  artist: string,
  durationMs: number,
): SearchResult {
  return {
    type: "track",
    id,
    title,
    artists: [{ id: `UC_${artist}`, name: artist }],
    durationMs,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  mocks.resolveDirectAudioStream.mockReset();
  mocks.searchRaw.mockReset();
  mocks.resolveSoundCloudStream.mockReset();
  vi.mocked(getJson).mockReset();
  vi.mocked(getJson).mockRejectedValue(new Error("soundcloud offline"));
  usePlayerStore.setState({ soundcloudFallback: true });
  clearYoutubeStandInCache();
});

describe("resolvePlaybackStream for youtube ids", () => {
  it("plays youtube tracks straight from googlevideo", async () => {
    mocks.resolveDirectAudioStream.mockResolvedValue(directStream);

    const stream = await resolvePlaybackStream(track("dQw4w9WgXcQ"));

    expect(stream).toMatchObject({
      url: directStream.url,
      expiresAtMs: Date.parse(directStream.expiresAt),
    });
    expect(mocks.resolveSoundCloudStream).not.toHaveBeenCalled();
  });

  it("surfaces the innertube error when youtube cannot play the track", async () => {
    usePlayerStore.setState({ soundcloudFallback: false });
    mocks.resolveDirectAudioStream.mockRejectedValue(
      new Error("LOGIN_REQUIRED"),
    );

    await expect(resolvePlaybackStream(track("dQw4w9WgXcQ"))).rejects.toThrow(
      "LOGIN_REQUIRED",
    );
  });

  it("rescues the track through a soundcloud stand-in when youtube fails", async () => {
    mocks.resolveDirectAudioStream.mockRejectedValue(
      new Error("LOGIN_REQUIRED"),
    );
    vi.mocked(getJson).mockResolvedValue({
      collection: [
        {
          id: 123,
          title: "The Weeknd - Blinding Lights",
          user: { username: "Weeknd Fans" },
          duration: 200_000,
        },
      ],
    });
    mocks.resolveSoundCloudStream.mockResolvedValue({
      url: "https://cf-media.sndcdn.com/standin",
      mimeType: "audio/mpeg",
      codec: "aac",
      bitrate: 128_000,
      expiresAt: null,
    });

    const stream = await resolvePlaybackStream(track("dQw4w9WgXcQ"));

    expect(stream).toMatchObject({ url: "https://cf-media.sndcdn.com/standin" });
    expect(mocks.resolveSoundCloudStream).toHaveBeenCalledWith("sc:123", {
      signal: undefined,
    });
  });

  it("rescues through the soundcloud stand-in when youtube hangs instead of erroring", async () => {
    // regression: a hung resolution stage used to keep the player in
    // "loading" forever and silently skip the stand-in, because the rescue
    // only ran from the catch path. The resolve deadline must convert the
    // hang into an error so the stand-in gets its chance.
    vi.useFakeTimers();
    try {
      mocks.resolveDirectAudioStream.mockImplementation(
        () => new Promise(() => {}),
      );
      vi.mocked(getJson).mockResolvedValue({
        collection: [
          {
            id: 123,
            title: "The Weeknd - Blinding Lights",
            user: { username: "Weeknd Fans" },
            duration: 200_000,
          },
        ],
      });
      mocks.resolveSoundCloudStream.mockResolvedValue({
        url: "https://cf-media.sndcdn.com/standin",
        mimeType: "audio/mpeg",
        codec: "aac",
        bitrate: 128_000,
        expiresAt: null,
      });

      const attempt = resolvePlaybackStream(track("dQw4w9WgXcQ"));
      const expectation = expect(attempt).resolves.toMatchObject({
        url: "https://cf-media.sndcdn.com/standin",
      });
      await vi.advanceTimersByTimeAsync(30_500);
      await expectation;
      expect(mocks.resolveSoundCloudStream).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rethrows the original error when the stand-in finds no match", async () => {
    mocks.resolveDirectAudioStream.mockRejectedValue(
      new Error("LOGIN_REQUIRED"),
    );
    vi.mocked(getJson).mockResolvedValue({ collection: [] });

    await expect(resolvePlaybackStream(track("dQw4w9WgXcQ"))).rejects.toThrow(
      "LOGIN_REQUIRED",
    );
    expect(mocks.resolveSoundCloudStream).not.toHaveBeenCalled();
  });
});

describe("resolvePlaybackStream for ids of unknown sources", () => {
  it("plays the matching youtube track", async () => {
    mocks.searchRaw.mockResolvedValue([
      searchTrack("4NRXx6U8ABQ", "Blinding Lights", "The Weeknd", 200_040),
    ]);
    mocks.resolveDirectAudioStream.mockResolvedValue(directStream);

    const stream = await resolvePlaybackStream(track("local-file-1"));

    expect(mocks.resolveDirectAudioStream).toHaveBeenCalledWith("4NRXx6U8ABQ", {
      signal: expect.any(AbortSignal),
    });
    expect(stream).toMatchObject({ url: directStream.url });
  });

  it("fails when youtube has no matching track", async () => {
    usePlayerStore.setState({ soundcloudFallback: false });
    mocks.searchRaw.mockResolvedValue([]);

    await expect(resolvePlaybackStream(track("local-file-2"))).rejects.toThrow(
      "No matching YouTube track found",
    );
  });
});
