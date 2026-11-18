import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getPlaylist, postInnertube } = vi.hoisted(() => ({
  getPlaylist: vi.fn(),
  postInnertube: vi.fn(),
}));

vi.mock("./innertubeClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./innertubeClient")>();
  return { ...actual, postInnertube };
});

vi.mock("./innertubeCollections", () => ({ getPlaylist }));

import {
  collectHomeFeedItems,
  fetchInnertubeHomeFeed,
  mapHomeShelf,
  mapTwoRowItem,
} from "./innertubeHomeFeed";

function trackItem(videoId: string, title: string, artist: string, album: string) {
  return {
    musicResponsiveListItemRenderer: {
      flexColumns: [
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: { runs: [{ text: title }] },
          },
        },
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: {
              runs: [
                { text: artist },
                { text: " • " },
                { text: "1.2B plays" },
              ],
            },
          },
        },
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: { runs: [{ text: album }] },
          },
        },
      ],
      overlay: {
        musicItemThumbnailOverlayRenderer: {
          content: {
            musicPlayButtonRenderer: {
              playNavigationEndpoint: {
                watchEndpoint: { videoId, playlistId: `RDAMVM${videoId}` },
              },
            },
          },
        },
      },
      thumbnail: {
        musicThumbnailRenderer: {
          thumbnail: {
            thumbnails: [
              { url: `https://yt3.example/${videoId}=w120-h120-l90-rj`, width: 120, height: 120 },
              { url: `https://yt3.example/${videoId}=w544-h544-l90-rj`, width: 544, height: 544 },
            ],
          },
        },
      },
    },
  };
}

function twoRowItem(
  id: string,
  title: string,
  pageType: string,
  subtitle: { text: string; artistId?: string }[] = [],
) {
  return {
    musicTwoRowItemRenderer: {
      title: { runs: [{ text: title }] },
      subtitle: {
        runs: subtitle.map((run, index) => ({
          text: index === 0 ? run.text : ` ${run.text}`,
          ...(run.artistId
            ? {
                navigationEndpoint: {
                  browseEndpoint: {
                    browseId: run.artistId,
                    browseEndpointContextSupportedConfigs: {
                      browseEndpointContextMusicConfig: {
                        pageType: "MUSIC_PAGE_TYPE_ARTIST",
                      },
                    },
                  },
                },
              }
            : {}),
        })),
      },
      navigationEndpoint: {
        browseEndpoint: {
          browseId: id,
          browseEndpointContextSupportedConfigs: {
            browseEndpointContextMusicConfig: { pageType },
          },
        },
      },
      thumbnailRenderer: {
        musicThumbnailRenderer: {
          thumbnail: {
            thumbnails: [
              { url: `https://yt3.example/${id}=w226-h226-l90-rj`, width: 226, height: 226 },
            ],
          },
        },
      },
    },
  };
}

function carousel(title: string | null, items: unknown[]) {
  return {
    musicCarouselShelfRenderer: {
      ...(title
        ? {
            header: {
              musicCarouselShelfBasicHeaderRenderer: {
                title: { runs: [{ text: title }] },
              },
            },
          }
        : {}),
      contents: items,
    },
  };
}

function homeResponse(shelves: unknown[], continuation?: string) {
  return {
    contents: {
      singleColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: shelves,
                  ...(continuation
                    ? {
                        continuations: [
                          { nextContinuationData: { continuation } },
                        ],
                      }
                    : {}),
                },
              },
            },
          },
        ],
      },
    },
  };
}

function continuationResponse(shelves: unknown[]) {
  return {
    continuationContents: {
      sectionListContinuationRenderer: { contents: shelves },
    },
  };
}

beforeEach(() => {
  postInnertube.mockReset();
  getPlaylist.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mapTwoRowItem", () => {
  it("maps playlist and album cards with id, title, subtitle and cover", () => {
    const playlist = mapTwoRowItem(
      twoRowItem("VLRDabc", "The Hits: 90s", "MUSIC_PAGE_TYPE_PLAYLIST", [
        { text: "Various Artists" },
      ]),
    );
    expect(playlist).toMatchObject({
      kind: "playlist",
      id: "VLRDabc",
      title: "The Hits: 90s",
      subtitle: "Various Artists",
      coverUrl: "https://yt3.example/VLRDabc=w226-h226-l90-rj",
    });

    const album = mapTwoRowItem(
      twoRowItem("MPREb_x", "Some Album", "MUSIC_PAGE_TYPE_ALBUM", [
        { text: "Artist One", artistId: "UCartist1" },
        { text: "•" },
        { text: "2024" },
      ]),
    );
    expect(album).toMatchObject({
      kind: "album",
      id: "MPREb_x",
      title: "Some Album",
      subtitle: "Artist One • 2024",
    });
    expect(album?.artists).toEqual([{ id: "UCartist1", name: "Artist One" }]);
  });

  it("falls back to a watch video card and rejects unmappable items", () => {
    const raw = twoRowItem("VLRDabc", "Video Thing", "MUSIC_PAGE_TYPE_VIDEO");
    delete (raw.musicTwoRowItemRenderer.navigationEndpoint as Record<string, unknown>)
      .browseEndpoint;
    (
      raw.musicTwoRowItemRenderer.navigationEndpoint as Record<string, unknown>
    ).watchEndpoint = { videoId: "abc123" };
    const video = mapTwoRowItem(raw);
    expect(video).toMatchObject({ kind: "video", id: "abc123" });

    expect(mapTwoRowItem({})).toBeNull();
    expect(mapTwoRowItem(null)).toBeNull();
  });
});

describe("mapHomeShelf", () => {
  it("splits list items into tracks and two-row items into collections", () => {
    const shelf = mapHomeShelf(
      carousel("Quick picks", [
        trackItem("aaa", "Beat It", "Michael Jackson", "Thriller"),
        twoRowItem("VLRDabc", "Playlist Card", "MUSIC_PAGE_TYPE_PLAYLIST"),
        trackItem("aaa", "Beat It", "Michael Jackson", "Thriller"),
      ]),
    );
    expect(shelf?.title).toBe("Quick picks");
    expect(shelf?.tracks).toHaveLength(1);
    expect(shelf?.tracks[0]).toMatchObject({ id: "aaa", title: "Beat It" });
    expect(shelf?.collections).toHaveLength(1);
    expect(shelf?.collections[0]).toMatchObject({ id: "VLRDabc" });
  });

  it("returns null for shelves without a renderer or with no items", () => {
    expect(mapHomeShelf({ musicCarouselShelfRenderer: { contents: [] } })).toBeNull();
    expect(mapHomeShelf({})).toBeNull();
    expect(mapHomeShelf(null)).toBeNull();
  });
});

describe("fetchInnertubeHomeFeed", () => {
  it("parses the home response shelves", async () => {
    postInnertube.mockResolvedValue(
      homeResponse([
        carousel("Quick picks", [trackItem("aaa", "One", "A", "X")]),
        carousel(null, [
          twoRowItem("VLRDabc", "Card", "MUSIC_PAGE_TYPE_PLAYLIST"),
        ]),
      ]),
    );
    const shelves = await fetchInnertubeHomeFeed();
    expect(postInnertube).toHaveBeenCalledTimes(1);
    expect(shelves).toHaveLength(2);
    expect(shelves[0]?.title).toBe("Quick picks");
    expect(shelves[0]?.tracks).toHaveLength(1);
    expect(shelves[1]?.collections).toHaveLength(1);
  });

  it("follows the section continuation and merges its shelves", async () => {
    postInnertube.mockImplementation((_endpoint: string, body: Record<string, unknown>) =>
      Promise.resolve(
        typeof body?.continuation === "string"
          ? continuationResponse([
              carousel("New releases", [
                twoRowItem("MPREb_x", "Album", "MUSIC_PAGE_TYPE_ALBUM"),
              ]),
            ])
          : homeResponse(
              [carousel("Quick picks", [trackItem("aaa", "One", "A", "X")])],
              "continuation-token",
            ),
      ),
    );
    const shelves = await fetchInnertubeHomeFeed();
    expect(postInnertube).toHaveBeenCalledTimes(2);
    expect(postInnertube).toHaveBeenNthCalledWith(
      2,
      "browse",
      { browseId: "FEmusic_home", continuation: "continuation-token" },
      { signal: undefined },
    );
    expect(shelves.map((shelf) => shelf.title)).toEqual([
      "Quick picks",
      "New releases",
    ]);
  });

  it("keeps going when the continuation pass fails", async () => {
    postInnertube.mockImplementation((_endpoint: string, body: Record<string, unknown>) =>
      typeof body?.continuation === "string"
        ? Promise.reject(new Error("boom"))
        : Promise.resolve(
            homeResponse([carousel("Quick picks", [trackItem("aaa", "One", "A", "X")])], "tok"),
          ),
    );
    const shelves = await fetchInnertubeHomeFeed();
    expect(shelves).toHaveLength(1);
    expect(shelves[0]?.tracks).toHaveLength(1);
  });

  it("falls back to the charts playlist when the rotation ships no track shelf", async () => {
    postInnertube.mockImplementation((endpoint: string, body: Record<string, unknown>) => {
      if (typeof body?.continuation === "string") return Promise.resolve({});
      if (body?.browseId === "FEmusic_charts") {
        return Promise.resolve(
          homeResponse([
            carousel("Video charts", [
              twoRowItem(
                "VLOLAK5uy_chart",
                "Trending 20 US",
                "MUSIC_PAGE_TYPE_PLAYLIST",
              ),
            ]),
          ]),
        );
      }
      return Promise.resolve(
        homeResponse([
          carousel("New releases", [
            twoRowItem("MPREb_x", "Album", "MUSIC_PAGE_TYPE_ALBUM"),
          ]),
        ]),
      );
    });
    getPlaylist.mockResolvedValue({
      id: "VLOLAK5uy_chart",
      title: "Trending 20 US",
      tracks: [
        { id: "hit1", title: "Hit", artists: [{ id: "a", name: "A" }], durationMs: 1000 },
      ],
    });

    const shelves = await fetchInnertubeHomeFeed();
    expect(postInnertube).toHaveBeenCalledWith(
      "browse",
      { browseId: "FEmusic_charts" },
      { signal: undefined },
    );
    expect(getPlaylist).toHaveBeenCalledWith("VLOLAK5uy_chart", undefined);
    const trackShelf = shelves.find((shelf) => shelf.tracks.length > 0);
    expect(trackShelf?.title).toBe("Trending 20 US");
    expect(trackShelf?.tracks[0]).toMatchObject({ id: "hit1", title: "Hit" });
  });

  it("degrades to collection-only shelves when charts fail too", async () => {
    postInnertube.mockImplementation((_endpoint: string, body: Record<string, unknown>) =>
      body?.browseId === "FEmusic_charts"
        ? Promise.reject(new Error("charts down"))
        : Promise.resolve(
            homeResponse([
              carousel("New releases", [
                twoRowItem("MPREb_x", "Album", "MUSIC_PAGE_TYPE_ALBUM"),
              ]),
            ]),
          ),
    );
    const shelves = await fetchInnertubeHomeFeed();
    expect(getPlaylist).not.toHaveBeenCalled();
    expect(shelves).toHaveLength(1);
    expect(shelves[0]?.collections).toHaveLength(1);
    expect(shelves[0]?.tracks).toHaveLength(0);
  });
});

describe("collectHomeFeedItems", () => {
  it("aggregates and dedupes tracks, albums and playlists", () => {
    const shelves = [
      {
        title: "Quick picks",
        tracks: [
          { id: "aaa", title: "One", artists: [], durationMs: 0 },
          { id: "bbb", title: "Two", artists: [], durationMs: 0 },
        ],
        collections: [],
      },
      {
        title: "New releases",
        tracks: [{ id: "aaa", title: "One", artists: [], durationMs: 0 }],
        collections: [
          { kind: "album", id: "MPREb_x", title: "Album", subtitle: null, coverUrl: null, artists: [] },
          { kind: "playlist", id: "VLRD_1", title: "PL 1", subtitle: null, coverUrl: null, artists: [] },
          { kind: "playlist", id: "VLRD_1", title: "PL 1 dup", subtitle: null, coverUrl: null, artists: [] },
          { kind: "video", id: "vid1", title: "Video", subtitle: null, coverUrl: null, artists: [] },
        ],
      },
    ] as const;
    const items = collectHomeFeedItems(shelves as never);
    expect(items.quickPicks.map((track) => track.id)).toEqual(["aaa", "bbb"]);
    expect(items.albums.map((album) => album.id)).toEqual(["MPREb_x"]);
    expect(items.playlists.map((playlist) => playlist.id)).toEqual(["VLRD_1"]);
  });
});
