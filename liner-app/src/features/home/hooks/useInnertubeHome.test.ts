import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchInnertubeHomeFeed } = vi.hoisted(() => ({
  fetchInnertubeHomeFeed: vi.fn(),
}));

vi.mock("@/shared/youtube/innertube/innertubeHomeFeed", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/shared/youtube/innertube/innertubeHomeFeed")
  >();
  return { ...actual, fetchInnertubeHomeFeed };
});

import {
  loadInnertubeHomeItems,
  resetInnertubeHomeCache,
} from "./useInnertubeHome";

function shelves(quickPicks: number, playlists = 1) {
  return [
    {
      title: "Quick picks",
      tracks: Array.from({ length: quickPicks }, (_, index) => ({
        id: `t${index}`,
        title: `Track ${index}`,
        artists: [],
        durationMs: 0,
      })),
      collections: [],
    },
    {
      title: "For you",
      tracks: [],
      collections: Array.from({ length: playlists }, (_, index) => ({
        kind: "playlist",
        id: `VL${index}`,
        title: `Playlist ${index}`,
        subtitle: null,
        coverUrl: null,
        artists: [],
      })),
    },
  ];
}

beforeEach(() => {
  resetInnertubeHomeCache();
  fetchInnertubeHomeFeed.mockReset();
});

afterEach(() => {
  resetInnertubeHomeCache();
  vi.restoreAllMocks();
});

describe("loadInnertubeHomeItems", () => {
  it("memoizes the result within its TTL window", async () => {
    fetchInnertubeHomeFeed.mockResolvedValue(shelves(20));
    const first = await loadInnertubeHomeItems();
    const again = await loadInnertubeHomeItems();
    expect(fetchInnertubeHomeFeed).toHaveBeenCalledTimes(1);
    expect(first.quickPicks).toHaveLength(20);
    expect(first.playlists).toHaveLength(1);
    expect(again).toBe(first);
  });

  it("exposes collections even when the rotation omits track shelves", async () => {
    fetchInnertubeHomeFeed.mockResolvedValue(shelves(0, 3));
    const items = await loadInnertubeHomeItems();
    expect(items.quickPicks).toHaveLength(0);
    expect(items.playlists).toHaveLength(3);
    expect(fetchInnertubeHomeFeed).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight fetch between concurrent callers", async () => {
    fetchInnertubeHomeFeed.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(shelves(20)), 5)),
    );
    const [a, b, c] = await Promise.all([
      loadInnertubeHomeItems(),
      loadInnertubeHomeItems(),
      loadInnertubeHomeItems(),
    ]);
    expect(fetchInnertubeHomeFeed).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
