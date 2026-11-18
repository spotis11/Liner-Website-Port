import { useEffect } from "react";
import { api, toClientTrack, mediaUrl } from "@/shared/api";
import { queryCache } from "@/shared/cache/queryCache";
import { innertubeCatalog } from "@/shared/youtube/innertube/innertubeCatalog";
import type { Track } from "@/shared/types";
import type { CollectionPageData } from "@/features/collection/hooks/useCollection";
import { loadWithRetry, useSessionOwner } from "./sessionAwareLoad";
import { loadInnertubeHomeItems } from "./useInnertubeHome";
import { freshFor, useCachedResource } from "@/shared/cache/useCachedResource";

export interface DailyMix {
  id: string;
  title: string;
  description: string;
  clusterArtists: string[];
  coverUrl?: string;
  trackCount: number;
  tracks: Track[];
}

export function getDailyMixArtists(
  clusterArtists?: string[],
  tracks?: Track[],
  targetCount: number = 4,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  const addName = (raw?: string) => {
    if (!raw) return;
    const name = raw.trim();
    if (
      !name ||
      name.toLowerCase() === "unknown" ||
      seen.has(name.toLowerCase())
    ) {
      return;
    }
    seen.add(name.toLowerCase());
    result.push(name);
  };

  if (Array.isArray(clusterArtists)) {
    for (const name of clusterArtists) {
      addName(name);
      if (result.length >= targetCount) return result;
    }
  }

  if (Array.isArray(tracks)) {
    for (const track of tracks) {
      if (track.artistList && track.artistList.length > 0) {
        for (const a of track.artistList) {
          addName(a.name);
          if (result.length >= targetCount) return result;
        }
      } else if (track.artists) {
        const parts = track.artists
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);
        for (const part of parts) {
          addName(part);
          if (result.length >= targetCount) return result;
        }
      }
    }
  }

  return result;
}

const EMPTY_MIXES: DailyMix[] = [];

function toDailyMixes(
  items: Awaited<ReturnType<typeof api.getDailyMixes>>["items"],
): DailyMix[] {
  return (items || []).map((mix) => {
    const clientTracks = (mix.tracks || []).map((t) => toClientTrack(t));
    const primaryCover = mix.cover?.url
      ? mediaUrl(mix.cover.url)
      : clientTracks[0]?.coverUrl || clientTracks[1]?.coverUrl;
    return {
      id: mix.id,
      title: mix.title,
      description: mix.description,
      clusterArtists: getDailyMixArtists(mix.clusterArtists, clientTracks, 4),
      coverUrl: primaryCover,
      trackCount: mix.trackCount || clientTracks.length,
      tracks: clientTracks,
    };
  });
}

function primeMixCollections(mixes: DailyMix[]): void {
  for (const mix of mixes) {
    const collectionData: CollectionPageData = {
      type: "playlist",
      title: mix.title,
      author:
        mix.clusterArtists.length > 0
          ? mix.clusterArtists.join(", ")
          : "Daily Mix",
      description: mix.description,
      coverUrl: mix.coverUrl || "",
      tracks: mix.tracks,
    };
    queryCache.set(`collection:playlist:${mix.id}`, collectionData);
  }
}

export function dailyMixesCacheKey(owner: string): string {
  return `home:daily-mixes:${owner}`;
}

const DAILY_MIXES_POLICY = {
  isFresh: freshFor(10 * 60_000),
  revalidateOnFocus: true,
  sessionOnly: true,
};

// Fallback "mixes" for visitors the site backend can't build recommendations
// for (no likes yet): the playlist shelves of YouTube Music's home feed, with
// their real track lists fetched through the innertube catalog. Ids are
// YouTube playlist browse ids (VL…), which the collection page already
// resolves through the same innertube layer.
const FALLBACK_MIX_LIMIT = 4;

async function loadInnertubeMixes(): Promise<DailyMix[]> {
  const feed = await loadInnertubeHomeItems();
  const candidates = feed.playlists.slice(0, FALLBACK_MIX_LIMIT);
  const mixes = await Promise.all(
    candidates.map(async (playlist): Promise<DailyMix | null> => {
      const details = await innertubeCatalog
        .getPlaylist(playlist.id)
        .catch(() => null);
      const tracks = (details?.tracks ?? [])
        .map((track) => toClientTrack(track))
        .filter((track) => track.id);
      if (tracks.length === 0) return null;
      return {
        id: playlist.id,
        title: playlist.title,
        description:
          playlist.subtitle ||
          playlist.artists.map((artist) => artist.name).join(", ") ||
          "YouTube Music",
        clusterArtists: getDailyMixArtists(undefined, tracks, 4),
        coverUrl:
          playlist.coverUrl ??
          details?.cover?.url ??
          tracks[0]?.coverUrl ??
          undefined,
        trackCount: details?.trackCount ?? tracks.length,
        tracks,
      };
    }),
  );
  return mixes.filter((mix): mix is DailyMix => mix !== null);
}

export function useDailyMixes() {
  const owner = useSessionOwner();
  const { data, isLoading } = useCachedResource(
    dailyMixesCacheKey(owner),
    () =>
      loadWithRetry(
        () => api.getDailyMixes(),
        () => true,
      )
        .then((res) => toDailyMixes(res.items))
        .catch(() => [] as DailyMix[])
        .then((mixes) =>
          mixes.length > 0 ? mixes : loadInnertubeMixes(),
        ),
    DAILY_MIXES_POLICY,
  );

  useEffect(() => {
    if (data) primeMixCollections(data);
  }, [data]);

  return { data: data ?? EMPTY_MIXES, isLoading };
}
