import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Focused tests for the music-video resolver:
 *  - tier 1: curated OMV rows (audioVariant "music-video")
 *  - tier 2: self-labelled official uploads by indie artists
 *    ("Verity Disstrack - Official Music Video" by Havexy is
 *    MUSIC_VIDEO_TYPE_UGC — YouTube never flags small channels as OMV)
 *  - junk rejection (sped up / lyric / remix / ...), title + artist gates
 *  - caches the outcome per track (one search per track)
 *  - falls back to null (caller keeps the own id) on any failure
 */

const mocks = vi.hoisted(() => ({
  searchRaw: vi.fn(async () => [] as unknown[]),
}));

vi.mock("@/shared/youtube", () => ({
  searchRaw: mocks.searchRaw,
}));

import {
  clearMusicVideoVersions,
  findMusicVideoVersion,
} from "./musicVideoVersion";

const TRACK = {
  id: "yt:SONGID00001",
  title: "Pepas",
  artists: "Farruko",
  artistList: [{ name: "Farruko", id: "UCartist1" }],
  durationMs: 248_000,
};

function videoResult(overrides: Record<string, unknown> = {}) {
  return {
    type: "track",
    id: "VIDEOID00001",
    title: "Pepas",
    artists: [{ name: "Farruko", id: "UCartist1" }],
    audioVariant: "music-video",
    durationMs: 200_000,
    ...overrides,
  } as unknown;
}

describe("findMusicVideoVersion", () => {
  beforeEach(() => {
    clearMusicVideoVersions();
    mocks.searchRaw.mockClear();
    mocks.searchRaw.mockResolvedValue([]);
  });

  it("finds the curated OMV by title and artist", async () => {
    mocks.searchRaw.mockResolvedValue([videoResult()]);
    const id = await findMusicVideoVersion(TRACK, "SONGID00001");
    expect(id).toBe("VIDEOID00001");
    expect(mocks.searchRaw).toHaveBeenCalledWith("Pepas Farruko", "video", undefined);
  });

  it("resolves self-labelled official uploads by indie artists (UGC tier)", async () => {
    // real-world shape: "Verity Disstrack - Official Music Video" by Havexy —
    // MUSIC_VIDEO_TYPE_UGC, channel id differs from the song row's artist link
    mocks.searchRaw.mockResolvedValue([
      videoResult({
        id: "wcudhZorXmo",
        title: "Verity Disstrack - Official Music Video",
        artists: [{ name: "Havexy", id: "UCqYyNTlwx8m" }],
        audioVariant: undefined,
        durationMs: 184_000,
      }),
    ]);
    const id = await findMusicVideoVersion(
      {
        id: "yt:zSdVHriWEfc",
        title: "Verity Disstrack",
        artists: "HaVexy",
        artistList: [{ name: "HaVexy", id: "UC8gDNJT2Z6nchPqRMtaBwVQ" }],
        durationMs: 185_000,
      },
      "zSdVHriWEfc",
    );
    expect(id).toBe("wcudhZorXmo");
  });

  it("matches artist-prefixed titles: 'Artist - Song (Official Music Video)'", async () => {
    mocks.searchRaw.mockResolvedValue([
      videoResult({
        id: "PREFIXVID01",
        title: "Farruko - Pepas (Official Music Video)",
        audioVariant: undefined,
        durationMs: 250_000,
      }),
    ]);
    expect(await findMusicVideoVersion(TRACK, "SONGID00001")).toBe("PREFIXVID01");
  });

  it("prefers the curated OMV over a self-labelled upload", async () => {
    mocks.searchRaw.mockResolvedValue([
      videoResult({
        id: "UGCVID0001",
        title: "Pepas - Official Music Video",
        audioVariant: undefined,
        durationMs: 200_000,
      }),
      videoResult({ id: "OMVVID00001" }),
    ]);
    expect(await findMusicVideoVersion(TRACK, "SONGID00001")).toBe("OMVVID00001");
  });

  it("rejects unlabelled UGC rows even when title and artist match", async () => {
    mocks.searchRaw.mockResolvedValue([
      videoResult({ audioVariant: undefined }),
    ]);
    expect(await findMusicVideoVersion(TRACK, "SONGID00001")).toBeNull();
  });

  it("rejects junk variants (sped up, lyric video, remix)", async () => {
    mocks.searchRaw.mockResolvedValue([
      videoResult({ id: "JUNK000001", title: "Pepas (sped up)" }),
      videoResult({
        id: "JUNK000002",
        title: "Pepas (Lyric Video)",
        audioVariant: undefined,
      }),
      videoResult({
        id: "JUNK000003",
        title: "Pepas (Phonk Remix)",
        audioVariant: undefined,
      }),
    ]);
    expect(await findMusicVideoVersion(TRACK, "SONGID00001")).toBeNull();
  });

  it("rejects hits with a different title", async () => {
    mocks.searchRaw.mockResolvedValue([videoResult({ title: "Pepas 2" })]);
    expect(await findMusicVideoVersion(TRACK, "SONGID00001")).toBeNull();
  });

  it("rejects hits from a different artist", async () => {
    mocks.searchRaw.mockResolvedValue([
      videoResult({
        artists: [{ name: "Someone Else", id: "UCother" }],
      }),
    ]);
    expect(await findMusicVideoVersion(TRACK, "SONGID00001")).toBeNull();
  });

  it("rejects uploads longer than a minute off the song length", async () => {
    mocks.searchRaw.mockResolvedValue([
      videoResult({
        id: "LOOPVID0001",
        title: "Pepas - Official Music Video",
        audioVariant: undefined,
        durationMs: 248_000 + 3_600_000,
      }),
    ]);
    expect(await findMusicVideoVersion(TRACK, "SONGID00001")).toBeNull();
  });

  it("rejects greyed-out (premium-only) rows", async () => {
    mocks.searchRaw.mockResolvedValue([
      videoResult({ audioVariant: "premium-only" }),
    ]);
    expect(await findMusicVideoVersion(TRACK, "SONGID00001")).toBeNull();
  });

  it("caches the outcome — the second call does not search again", async () => {
    mocks.searchRaw.mockResolvedValue([videoResult()]);
    await findMusicVideoVersion(TRACK, "SONGID00001");
    await findMusicVideoVersion(TRACK, "SONGID00001");
    expect(mocks.searchRaw).toHaveBeenCalledTimes(1);
  });

  it("skips the search when the track already is the official video", async () => {
    const result = await findMusicVideoVersion(
      { ...TRACK, audioVariant: "music-video" as const },
      "SONGID00001",
    );
    expect(result).toBeNull();
    expect(mocks.searchRaw).not.toHaveBeenCalled();
  });

  it("returns null when the search throws", async () => {
    mocks.searchRaw.mockRejectedValue(new Error("offline"));
    expect(await findMusicVideoVersion(TRACK, "SONGID00001")).toBeNull();
  });
});
