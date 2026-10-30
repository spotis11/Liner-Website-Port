import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  normalizeForMatch,
  scoreStandInCandidate,
  pickBestStandIn,
  resolveSoundCloudStandIn,
  standInQuery,
  compactTitleScore,
} from "./soundcloudStandIn";

vi.mock("@/shared/media/soundcloud/soundcloudCatalogRequest", () => ({
  getJson: vi.fn(),
}));

vi.mock("@/shared/media/soundcloud/soundcloudStream", () => ({
  resolveSoundCloudStream: vi.fn(),
}));

import { getJson } from "@/shared/media/soundcloud/soundcloudCatalogRequest";
import { resolveSoundCloudStream } from "@/shared/media/soundcloud/soundcloudStream";

const mockedGetJson = vi.mocked(getJson);
const mockedResolve = vi.mocked(resolveSoundCloudStream);

const track = {
  id: "VrZpGEO_o5Q",
  title: "Flashback",
  artists: "JD Smith",
  durationMs: 264_000,
};

const sc = (id: number, title: string, artist: string, durationMs: number) => ({
  id,
  title,
  user: { username: artist },
  duration: durationMs,
});

describe("normalizeForMatch", () => {
  it("strips brackets, feat tags and punctuation", () => {
    expect(normalizeForMatch("Flashback (Official Video)")).toBe("flashback");
    expect(normalizeForMatch("JD Smith - Flashback [HQ]")).toBe(
      "jd smith flashback",
    );
    expect(normalizeForMatch("Black Sunrise feat. Denniz Jamm!")).toBe(
      "black sunrise denniz jamm",
    );
  });
});

describe("compactTitleScore", () => {
  it("joins word-boundary gaps (Blacksunrise vs Black Sunrise)", () => {
    // bracketed suffixes are stripped before compacting -> plain equality
    expect(compactTitleScore("Blacksunrise", "Black Sunrise [NCS Release]")).toBe(1);
    expect(compactTitleScore("Black Sunrise", "Blacksunrise (extended)")).toBe(1);
    expect(compactTitleScore("Flashback", "JD Smith - Flashback")).toBe(0.95);
    expect(compactTitleScore("Black Sunrise", "Black Sunrise")).toBe(1);
  });

  it("never contain-matches short needles", () => {
    expect(compactTitleScore("Neon", "Neonlights (remix)")).toBe(0);
    expect(compactTitleScore("Flash", "Flashback by someone")).toBe(0);
    expect(compactTitleScore("Sunrise", "Blacksunrise")).toBe(0.95); // 7 chars is long enough
  });
});

describe("scoreStandInCandidate", () => {
  it("accepts an exact title+artist match", () => {
    const score = scoreStandInCandidate(track, {
      id: "sc:1",
      title: "JD Smith - Flashback [Original Mix]",
      artist: "BitPull",
      durationMs: 186_000,
    });
    expect(score).toBeGreaterThan(2.5);
  });

  it("rejects unrelated titles", () => {
    expect(
      scoreStandInCandidate(track, {
        id: "sc:2",
        title: "Sunrise Is Black",
        artist: "The Revenge Project",
        durationMs: 264_000,
      }),
    ).toBe(0);
  });

  it("rejects matching titles by a different artist when artist data exists", () => {
    expect(
      scoreStandInCandidate(track, {
        id: "sc:3",
        title: "Flashback",
        artist: "Vini Vici",
        durationMs: 264_000,
      }),
    ).toBe(0);
  });

  it("accepts a space-mangled title when the artists still match (Blacksunrise)", () => {
    // youtube import stored the title without spaces; soundcloud has the NCS upload
    const score = scoreStandInCandidate(
      {
        title: "Blacksunrise",
        artists: "Andreas Stone, Denniz Jamm",
        durationMs: 232_000,
      },
      {
        id: "sc:ncs",
        title: "Andreas Stone With Denniz Jamm - Black Sunrise [NCS Release]",
        artist: "NCS",
        durationMs: 232_000,
      },
    );
    expect(score).toBeGreaterThan(2.5);
  });

  it("tolerates duration gaps up to the tolerance window", () => {
    // 264s vs 186s = 78s apart; tolerance is max(35% of 264s, 45s) = 92.4s
    const within = scoreStandInCandidate(track, {
      id: "sc:4",
      title: "JD Smith - Flashback",
      artist: "BitPull",
      durationMs: 186_000,
    });
    expect(within).toBeGreaterThan(0);
    // 10 minutes off is a different recording
    expect(
      scoreStandInCandidate(track, {
        id: "sc:5",
        title: "JD Smith - Flashback",
        artist: "BitPull",
        durationMs: 600_000,
      }),
    ).toBe(0);
  });
});

describe("pickBestStandIn", () => {
  it("picks the strongest candidate", () => {
    const best = pickBestStandIn(track, [
      { id: "sc:1", title: "Flashback (remix by someone)", artist: "Totally Different", durationMs: 264_000 },
      { id: "sc:2", title: "JD Smith - Flashback", artist: "BitPull", durationMs: 240_000 },
      { id: "sc:3", title: "Flashback", artist: "JD Smith", durationMs: 264_000 },
    ]);
    // exact artist+title with closer duration wins
    expect(best?.trackId).toBe("sc:3");
  });

  it("returns null when nothing matches", () => {
    expect(
      pickBestStandIn(track, [
        { id: "sc:9", title: "Cotton Eye Joe", artist: "Rednex", durationMs: 200_000 },
      ]),
    ).toBeNull();
  });
});

describe("resolveSoundCloudStandIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries SoundCloud with title+artists and streams the best match", async () => {
    mockedGetJson.mockResolvedValue({
      collection: [
        sc(438298038, "Black Sunrise (Extended)", "Cosmic Awakenings", 600_000),
        sc(947190253, "Andreas Stone With Denniz Jamm - Black Sunrise", "NCS", 232_000),
      ],
    });
    mockedResolve.mockResolvedValue({
      url: "https://cf-media.sndcdn.com/x",
      mimeType: "audio/mpeg",
      codec: "aac" as const,
      bitrate: 128_000,
      expiresAt: null,
    });

    const stream = await resolveSoundCloudStandIn({
      id: "sp_track_black_sunrise",
      title: "Black Sunrise",
      artists: "Andreas Stone, Denniz Jamm",
      durationMs: 244_000,
    });

    expect(mockedGetJson).toHaveBeenCalledWith(
      "/search/tracks",
      { q: "Black Sunrise Andreas Stone Denniz Jamm", limit: "12" },
      undefined,
    );
    expect(mockedResolve).toHaveBeenCalledWith("sc:947190253", { signal: undefined });
    expect(stream.url).toContain("sndcdn.com");
  });

  it("throws when no confident match exists", async () => {
    mockedGetJson.mockResolvedValue({
      collection: [sc(1, "Unrelated Song", "Someone", 100_000)],
    });
    await expect(
      resolveSoundCloudStandIn({
        id: "x",
        title: "Flashback",
        artists: "JD Smith",
        durationMs: 264_000,
      }),
    ).rejects.toThrow(/no confident match/i);
    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it("propagates the abort signal into the search and stream", async () => {
    const controller = new AbortController();
    controller.abort();
    mockedGetJson.mockRejectedValue(new DOMException("Aborted", "AbortError"));
    await expect(
      resolveSoundCloudStandIn(track, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("retries with the bare title when the full query finds no confident match", async () => {
    mockedGetJson.mockImplementation((_path: string, params: Record<string, string>) => {
      if (params.q === "Black Sunrise") {
        return Promise.resolve({
          collection: [
            sc(
              947190253,
              "Andreas Stone With Denniz Jamm - Black Sunrise [NCS Release]",
              "NCS",
              232_000,
            ),
          ],
        });
      }
      // the long "title artists" query drifts away on soundcloud's ranking
      return Promise.resolve({
        collection: [sc(1, "Unrelated Song", "Someone", 100_000)],
      });
    });
    mockedResolve.mockResolvedValue({
      url: "https://cf-media.sndcdn.com/x",
      mimeType: "audio/mpeg",
      codec: "aac" as const,
      bitrate: 128_000,
      expiresAt: null,
    });

    const stream = await resolveSoundCloudStandIn({
      id: "RCuIzEZU2KQ",
      title: "Black Sunrise",
      artists: "Andreas Stone, Denniz Jamm",
      durationMs: 232_000,
    });

    expect(mockedGetJson).toHaveBeenCalledTimes(2);
    expect(mockedGetJson).toHaveBeenNthCalledWith(
      1,
      "/search/tracks",
      { q: "Black Sunrise Andreas Stone Denniz Jamm", limit: "12" },
      undefined,
    );
    expect(mockedGetJson).toHaveBeenNthCalledWith(
      2,
      "/search/tracks",
      { q: "Black Sunrise", limit: "12" },
      undefined,
    );
    expect(mockedResolve).toHaveBeenCalledWith("sc:947190253", {
      signal: undefined,
    });
    expect(stream.url).toContain("sndcdn.com");
  });
});

describe("standInQuery", () => {
  it("combines title and first artists", () => {
    expect(standInQuery(track)).toBe("Flashback JD Smith");
  });
});
