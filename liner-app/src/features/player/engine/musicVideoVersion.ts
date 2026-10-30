import type { SearchResult } from "@/shared/contracts";
import type { Track } from "@/shared/types";
import { searchRaw } from "@/shared/youtube";
import { isAbortError } from "@/shared/utils/abort";

/**
 * YouTube Music keeps two ids per song: the *song* row (an art-track video
 * whose frame is a static cover) and the *music video*. Our tracks mostly
 * carry the song id, so Video mode would show a frozen cover — not what
 * anyone expects from the video toggle.
 *
 * Videos surface through two different paths, and both must be handled:
 *
 * 1. Curated OMVs (major labels): the video row is flagged
 *    MUSIC_VIDEO_TYPE_OMV → audioVariant "music-video".
 * 2. Self-labelled uploads by independent artists (e.g. Havexy's
 *    "Verity Disstrack - Official Music Video", 5.5M views): YouTube
 *    never curates small channels, so the row stays MUSIC_VIDEO_TYPE_UGC.
 *    These are matched by the artist's own channel plus a title that
 *    reduces to the song title once official-video decorations are
 *    stripped.
 *
 * Junk (sped up / slowed / lyric / remix / mashup / ...) is rejected in
 * both paths. Best-effort by design — if nothing trustworthy matches, the
 * caller keeps the track's own id.
 */

const videoVersions = new Map<string, string | null>();

type VideoTrack = Pick<
  Track,
  "id" | "title" | "artists" | "artistList" | "audioVariant" | "durationMs"
>;

type VideoResult = Extract<SearchResult, { type: "track" }>;

const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const OFFICIAL_MARKERS = /official|music\s*video|videoclip|\bmv\b|m\/v/i;

/** Junk anywhere in a decoration (parenthesised / bracketed / dash suffix). */
const DECORATION_JUNK =
  /\blyrics?\b|\bsped\b|\bslowed\b|\breverb\b|\bnightcore\b|\bkaraoke\b|\bcovers?\b|\bcover\s+art\b|\breaction\b|\blive\b|\binstrumental\b|\b8d\b|\bmashup\b|\bfanmade\b|\bfan\s*made\b|\bremix(?:es)?\b|\bbut\s+it\b|\bparody\b|\btutorial\b|\bbeatbox\b/i;

/** Blatant junk in the plain title — stricter, guards self-similar uploads. */
const TITLE_JUNK =
  /\blyrics?\b|\bsped\b|\bslowed\b|\breverb\b|\bnightcore\b|\bkaraoke\b|\b8d\b|\bmashup\b|\bfanmade\b|\bfan\s*made\b|\breaction\b|\bbut\s+it\b|\bparody\b|\bremix(?:es)?\b/i;

const isChannelId = (id: string | undefined): id is string =>
  Boolean(id?.startsWith("UC"));

function primaryArtist(track: VideoTrack): { id?: string; name: string } | null {
  const listed = track.artistList?.[0];
  if (listed?.name) return { id: listed.id, name: listed.name };
  const name = track.artists?.split(",")[0]?.trim();
  return name ? { name } : null;
}

/**
 * Reduces a video title to the song title candidates it may represent.
 * "Verity Disstrack - Official Music Video" → { "verity disstrack" },
 * marking that an official-video decoration was present.
 */
function titleCandidates(title: string): {
  cores: Set<string>;
  official: boolean;
  junk: boolean;
} {
  let official = false;
  let junk = TITLE_JUNK.test(title);
  let core = title;
  for (const match of title.matchAll(/[([]([^\])}]*)[)\]]/g)) {
    const group = match[1] ?? "";
    if (OFFICIAL_MARKERS.test(group)) {
      official = true;
      core = core.replace(match[0], " ");
    }
    if (DECORATION_JUNK.test(group)) junk = true;
  }
  // dash suffixes: "Song - Official Music Video" → "Song"
  const segments = core
    .split(/\s+[-–—]\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length > 1) {
    const tail = segments.slice(1).join(" - ");
    if (OFFICIAL_MARKERS.test(tail)) {
      official = true;
      core = segments[0];
    }
    if (DECORATION_JUNK.test(tail)) junk = true;
  }
  const cores = new Set<string>([core, ...segments].map(normalize));
  return { cores, official, junk };
}

/** Videos add intros/outros; beyond a minute the recording is a different one. */
function durationPenalty(videoMs: number, trackMs: number): number | null {
  if (videoMs <= 0 || trackMs <= 0) return 0.5;
  if (Math.abs(videoMs - trackMs) > 60_000) return null;
  const diff = Math.abs(videoMs - trackMs);
  if (diff <= 4_000) return 1;
  if (diff <= 10_000) return 0.75;
  return 0.25;
}

interface Candidate {
  id: string;
  tier: 1 | 2;
  score: number;
  order: number;
}

function evaluate(
  result: SearchResult,
  track: VideoTrack,
  artist: { id?: string; name: string },
  ownVideoId: string,
  order: number,
): Candidate | null {
  if (result.type !== "track") return null;
  if (result.id === ownVideoId) return null;
  if (result.audioVariant === "premium-only") return null;
  // the song row's artist link (YT Music artist page) and the video
  // uploader's channel id frequently differ — match either id or name
  const artistMatch = result.artists.some(
    (candidate) =>
      (isChannelId(artist.id) && artist.id === candidate.id) ||
      normalize(candidate.name) === normalize(artist.name),
  );
  if (!artistMatch) return null;
  const parts = titleCandidates(result.title);
  if (parts.junk) return null;
  if (!parts.cores.has(normalize(track.title))) return null;
  // tier 1: curated OMV — trust the marker alone
  if (result.audioVariant === "music-video") {
    const score = durationPenalty(result.durationMs, track.durationMs);
    return score === null ? null : { id: result.id, tier: 1, score, order };
  }
  // tier 2: uncurated upload — only when the video vouches for itself
  // ("(Official Music Video)" / "- Official Video" / "(MV)")
  if (!parts.official) return null;
  const score = durationPenalty(result.durationMs, track.durationMs);
  return score === null ? null : { id: result.id, tier: 2, score, order };
}

function outranks(candidate: Candidate, best: Candidate): boolean {
  if (candidate.tier !== best.tier) return candidate.tier < best.tier;
  if (candidate.score !== best.score) return candidate.score > best.score;
  return candidate.order < best.order;
}

export function clearMusicVideoVersions(): void {
  videoVersions.clear();
}

/**
 * Resolves the music video id for a track, or null when none is found (the
 * search outcome is cached either way). `ownVideoId` is the id we would
 * otherwise display — the track's own YouTube video.
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
  if (!artist || !track.title?.trim()) return null;
  try {
    const results = await searchRaw(
      `${track.title} ${artist.name}`,
      "video",
      signal,
    );
    let best: Candidate | null = null;
    for (let order = 0; order < results.length; order += 1) {
      const candidate = evaluate(
        results[order]!,
        track,
        artist,
        ownVideoId,
        order,
      );
      if (candidate && (!best || outranks(candidate, best))) best = candidate;
    }
    videoVersions.set(track.id, best?.id ?? null);
    return best?.id ?? null;
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    return null;
  }
}
