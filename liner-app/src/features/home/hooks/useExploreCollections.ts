import { api } from "@/shared/api";
import type { PopularItem } from "./usePopularTracks";
import { loadInnertubeHomeItems } from "./useInnertubeHome";
import { freshFor, useCachedResource } from "@/shared/cache/useCachedResource";

const EMPTY_ITEMS: PopularItem[] = [];
const EXPLORE_POLICY = { isFresh: freshFor(10 * 60_000) };

function useCachedItems(key: string, load: () => Promise<PopularItem[]>) {
  const { data, isLoading } = useCachedResource(
    `home:${key}`,
    load,
    EXPLORE_POLICY,
  );
  return { items: data ?? EMPTY_ITEMS, isLoading };
}

const MIN_TOP_ALBUM_TRACKS = 5;
const TOP_ALBUMS_LIMIT = 20;

async function loadPopularAlbums(): Promise<PopularItem[]> {
  const response = await api
    .getPopularAlbums("7d", TOP_ALBUMS_LIMIT * 2)
    .catch(() => null);
  const albums = (response?.items ?? []).filter(
    (album) => album.trackCount >= MIN_TOP_ALBUM_TRACKS,
  );
  if (albums.length > 0) {
    return albums.slice(0, TOP_ALBUMS_LIMIT).map((album) => ({
      type: "album",
      item: {
        id: album.id,
        title: album.title,
        artist: album.artist,
        coverUrl: album.coverUrl ?? "",
        totalTracks: album.trackCount,
        albumType: "album",
      },
      playCount: album.playCount,
    }));
  }
  // the site backend has no community data for a fresh visitor — surface
  // YouTube Music's home feed album shelves ("New releases", ...) instead
  const feed = await loadInnertubeHomeItems();
  return feed.albums.slice(0, TOP_ALBUMS_LIMIT).map((album): PopularItem => ({
    type: "album",
    item: {
      id: album.id,
      title: album.title,
      artist:
        album.artists.map((artist) => artist.name).join(", ") ||
        album.subtitle ||
        "",
      coverUrl: album.coverUrl ?? "",
      totalTracks: 0,
      albumType: "album",
    },
    playCount: 0,
  }));
}

async function loadMostSaved(): Promise<PopularItem[]> {
  const response = await api.getMostSaved("all", 20).catch(() => null);
  const entries = response?.items ?? [];
  if (entries.length > 0) {
    return entries.map((entry): PopularItem =>
      entry.type === "album"
        ? {
            type: "album",
            item: {
              id: entry.id,
              title: entry.title,
              artist: entry.subtitle,
              coverUrl: entry.coverUrl ?? "",
              totalTracks: 0,
              albumType: "album",
            },
            playCount: entry.saves,
          }
        : {
            type: "playlist",
            item: {
              id: entry.id,
              title: entry.title,
              owner: entry.subtitle,
              coverUrl: entry.coverUrl ?? "",
              totalTracks: 0,
            },
            playCount: entry.saves,
          },
    );
  }
  // fresh visitor -> YouTube Music home feed playlist shelves
  const feed = await loadInnertubeHomeItems();
  return feed.playlists.slice(0, 20).map(
    (playlist): PopularItem => ({
      type: "playlist",
      item: {
        id: playlist.id,
        title: playlist.title,
        owner:
          playlist.artists.map((artist) => artist.name).join(", ") ||
          playlist.subtitle ||
          "YouTube Music",
        coverUrl: playlist.coverUrl ?? "",
        totalTracks: 0,
      },
      playCount: 0,
    }),
  );
}

export function usePopularAlbums() {
  return useCachedItems("popular-albums", loadPopularAlbums);
}

export function useMostSaved() {
  return useCachedItems("most-saved", loadMostSaved);
}
