import { useMemo } from "react";
import { api, toClientTrack } from "@/shared/api";
import type { Track } from "@/shared/types";
import { freshFor, useCachedResource } from "@/shared/cache/useCachedResource";
import { loadInnertubeHomeItems } from "./useInnertubeHome";

const LISTENING_NOW_LIMIT = 10;
const LISTENING_NOW_POLICY = {
  isFresh: freshFor(5 * 60_000),
  maxAgeMs: 24 * 60 * 60_000,
};

const sessionRank = new Map<string, number>();

function rankOf(id: string): number {
  let rank = sessionRank.get(id);
  if (rank === undefined) {
    rank = Math.random();
    sessionRank.set(id, rank);
  }
  return rank;
}

export function useListeningNow() {
  const { data, isLoading } = useCachedResource(
    "home:listening-now",
    // the relay now serves explore/popular from the REAL Liner upstream
    // (anonymous forward — the same trending the Liner desktop home shows);
    // the YouTube Music feed (innertube "Quick picks") is only a last resort
    // for when even that fails, and its geo-personalized feed can surface
    // unrelated regional tracks, so it must never shadow real Liner data
    () =>
      api
        .getPopularTracks("12h", LISTENING_NOW_LIMIT)
        .then((response) =>
          (response.items ?? []).map((entry) => toClientTrack(entry.track)),
        )
        .catch(() => [])
        .then((tracks) =>
          tracks.length > 0
            ? tracks
            : loadInnertubeHomeItems().then((feed) =>
                feed.quickPicks
                  .slice(0, LISTENING_NOW_LIMIT)
                  .map((track) => toClientTrack(track)),
              ),
        ),
    LISTENING_NOW_POLICY,
  );

  const tracks = useMemo<Track[]>(
    () =>
      [...(data ?? [])]
        .sort((a, b) => rankOf(a.id) - rankOf(b.id))
        .slice(0, LISTENING_NOW_LIMIT),
    [data],
  );

  return { tracks, isLoading };
}
