import { api, toClientTrack } from "@/shared/api";
import type { Track } from "@/shared/types";
import { freshFor, useCachedResource } from "@/shared/cache/useCachedResource";
import { loadInnertubeHomeItems } from "./useInnertubeHome";

export type PopularTrackItem = Track;

export interface PopularAlbumItem {
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
  totalTracks: number;
  albumType: string;
  explicit?: boolean;
}

export interface PopularPlaylistItem {
  id: string;
  title: string;
  owner: string;
  coverUrl: string;
  totalTracks: number;
}

export type PopularItem =
  | { type: "track"; item: PopularTrackItem; playCount: number }
  | { type: "album"; item: PopularAlbumItem; playCount: number }
  | { type: "playlist"; item: PopularPlaylistItem; playCount: number };

export const popularTracksKeys = {
  all: ["popular"] as const,
  onlyTracks: ["popularTracks"] as const,
};

export const popularTracksAllTimeKeys = {
  allTime: ["popularTracksAllTime"] as const,
};

const EMPTY_ITEMS: PopularItem[] = [];
const POPULAR_POLICY = { isFresh: freshFor(10 * 60_000) };

function usePopularTracks(range: "7d" | "all", limit: number) {
  const { data, isLoading } = useCachedResource(
    `home:popular-tracks:${range}:${limit}`,
    // empty site backend (fresh visitor) -> YouTube Music home feed Quick picks
    () =>
      api
        .getPopularTracks(range, limit)
        .then((res) =>
          (res.items || []).map((entry): PopularItem => ({
            type: "track",
            item: toClientTrack(entry.track),
            playCount: entry.playCount,
          })),
        )
        .catch(() => [] as PopularItem[])
        .then((items) =>
          items.length > 0
            ? items
            : loadInnertubeHomeItems().then((feed) =>
                feed.quickPicks
                  .slice(0, limit)
                  .map((track): PopularItem => ({
                    type: "track",
                    item: toClientTrack(track),
                    playCount: 0,
                  })),
              ),
        ),
    POPULAR_POLICY,
  );
  return { data: data ?? EMPTY_ITEMS, isLoading };
}

export function usePopularTracksOnly(limit = 20) {
  return usePopularTracks("7d", limit);
}

export function usePopularTracksAllTime(limit = 20) {
  return usePopularTracks("all", limit);
}
