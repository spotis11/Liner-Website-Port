import type { SearchResult, Track } from "@/shared/contracts";
import { searchRaw } from "@/shared/youtube";
import { isAbortError } from "@/shared/utils/abort";

/**
 * YouTube Music keeps two ids per song: the *song* row (an art-track video
 * whose frame is a static cover) and the *official music video* (OMV). Our
 * tracks mostly carry the song id, so Video mode would show a frozen cover —
 * not what anyone expects from the video toggle.
 *
 * This resolver finds the OMV counterpart via YT Music's video search: the
 * mapper marks official videos with MUSIC_VIDEO_TYPE_OMV, which surfaces as
 * audioVariant "music-video". Best-effort by design — if nothing trustworthy
 * matches, the caller keeps the track's own id.
 */

const videoVersions = new Map<string, string | null>();

type VideoTrack = Pick<Track, "id" | "title" | "artists" | "artistList" | "audioVariant">;

type VideoResult = Extract<SearchResult, { type: "track" }>;

const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const isChannelId = (id: string | undefined): id is string =>
  Boolean(id?.startsWith("UC"));

function primaryArtist(track: VideoTrack): { id?: string; name: string } | null {
  const listed = track.artistList?.[0];
  if (listed?.name) return { id: listed.id, name: listed.name };
  const name = track.artists.split(",")[0]?.trim();
  return name ? { name } : null;
}

function isOfficialVideo(
  result: SearchResult,
  track: VideoTrack,
  artist: { id?: string; name: string },
  ownVideoId: string,
): result is VideoResult {
  if (result.type !== "track") return false;
  // only a real OMV counts — anything else is the same static art track
  if (result.audioVariant !== "music-video") return false;
  if (result.id === ownVideoId) return false;
  if (normalize(result.title) !== normalize(track.title)) return false;
  return result.artists.some((candidate) =>
    isChannelId(artist.id) && isChannelId(candidate.id)
      ? candidate.id === artist.id
      : normalize(candidate.name) === normalize(artist.name),
  );
}

export function clearMusicVideoVersions(): void {
  videoVersions.clear();
}

/**
 * Resolves the official music video id for a track, or null when none is
 * found (the search outcome is cached either way). `ownVideoId` is the id we
 * would otherwise display — the track's own YouTube video.
 */
export async function findMusicVideoVersion(
  track: VideoTrack,
  ownVideoId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (videoVersions.has(track.id)) return videoVersions.get(track.id) ?? null;
  // the row already IS the official video — nothing to look up
  if (track.audioVariant === "music-video") return null;
  const artist = primaryArtist(track);
  if (!artist || !track.title.trim()) return null;
  try {
    const results = await searchRaw(
      `${track.title} ${artist.name}`,
      "video",
      signal,
    );
    const match = results.find((result) =>
      isOfficialVideo(result, track, artist, ownVideoId),
    );
    videoVersions.set(track.id, match?.id ?? null);
    return match?.id ?? null;
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    return null;
  }
}
