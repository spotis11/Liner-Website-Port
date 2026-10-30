import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Focused tests for the official-music-video resolver:
 *  - picks the OMV search hit with matching title/artist
 *  - rejects art tracks, non-videos and mismatched titles
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

  it("finds the official video by title and artist", async () => {
    mocks.searchRaw.mockResolvedValue([videoResult()]);
    const id = await findMusicVideoVersion(TRACK, "SONGID00001");
    expect(id).toBe("VIDEOID00001");
    expect(mocks.searchRaw).toHaveBeenCalledWith("Pepas Farruko", "video", undefined);
  });

  it("rejects hits without the music-video variant", async () => {
    mocks.searchRaw.mockResolvedValue([videoResult({ audioVariant: undefined })]);
    expect(await findMusicVideoVersion(TRACK, "SONGID00001")).toBeNull();
  });

  it("rejects hits with a different title", async () => {
    mocks.searchRaw.mockResolvedValue([videoResult({ title: "Pepas (Remix)" })]);
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
