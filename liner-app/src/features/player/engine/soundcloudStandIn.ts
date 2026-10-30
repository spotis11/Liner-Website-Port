// Liner web port: SoundCloud stand-in rescue.
//
// Uncached YouTube tracks can be unplayable on the web when YouTube
// bot-checks the datacenter egress the proxies share (the desktop never sees
// this — it streams from the user's home IP). When everything on the YouTube
// side fails, the same song often exists on SoundCloud, whose API has no such
// gating. This module searches SoundCloud for "<title> <artists>" and picks
// the best title/artist/duration match so the user still hears the track.

import { log } from "@/shared/utils/logger";
import { asArray } from "@/shared/utils/json";
import { getJson } from "@/shared/media/soundcloud/soundcloudCatalogRequest";
import { mapSoundCloudCatalogTrack } from "@/shared/media/soundcloud/soundcloudMappers";
import {
  resolveSoundCloudStream,
  type ResolvedSoundCloudStream,
} from "@/shared/media/soundcloud";
import type { PlayableTrack } from "./playbackStream";

export interface SoundCloudStandInMatch {
  trackId: string;
  title: string;
  artist: string;
  durationMs: number;
  score: number;
}

export interface SoundCloudStandInOptions {
  signal?: AbortSignal;
  /** override the match gate in tests */
  candidates?: ApiCandidate[];
}

interface ApiCandidate {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
}

/** lowercase, strip punctuation/brackets/feat-tags so matching is fuzzy */
export function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/\(([^)]*)\)|\[([^\]]*)\]/g, " ")
    .replace(/\b(feat|ft|featuring|prod|official|video|audio|lyrics?|hd|hq)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  const normalized = normalizeForMatch(value);
  return normalized ? normalized.split(" ") : [];
}

/** fraction of `wanted` tokens present in `have` */
function tokenCoverage(wanted: string[], have: string[]): number {
  if (!wanted.length) return 0;
  const haveSet = new Set(have);
  let hit = 0;
  for (const token of wanted) if (haveSet.has(token)) hit += 1;
  return hit / wanted.length;
}

/** lowercase normalized text with ALL spaces removed — joins word-boundary gaps */
function compactForm(value: string): string {
  return normalizeForMatch(value).replace(/\s+/g, "");
}

/**
 * Word-boundary-independent title comparison: youtube imports sometimes store
 * the title without spaces ("Blacksunrise") while SoundCloud writes
 * "Black Sunrise" — token coverage scores 0 for that pair. Compare the space
 * -stripped forms instead (equality 1.0, containment of a reasonably long
 * needle 0.95). The needle is the wanted track title, so it is a whole title,
 * not an arbitrary token — short needles (<6 chars, "Flash" ⊂ "Flashback")
 * never contain-match.
 */
export function compactTitleScore(wanted: string, have: string): number {
  const needle = compactForm(wanted);
  const haystack = compactForm(have);
  if (!needle || !haystack) return 0;
  if (needle === haystack) return 1;
  if (needle.length >= 6 && haystack.includes(needle)) return 0.95;
  return 0;
}

function durationScore(wantedMs: number, candidateMs: number): number {
  if (!wantedMs || !candidateMs) return 0.5; // unknown lengths neither help nor hurt
  const delta = Math.abs(wantedMs - candidateMs);
  const tolerance = Math.max(wantedMs * 0.35, 45_000);
  if (delta > tolerance) return 0;
  return 1 - delta / tolerance;
}

/**
 * Score a candidate against the wanted track.
 * Title and artist must both be recognisable; duration breaks ties.
 */
export function scoreStandInCandidate(
  track: Pick<PlayableTrack, "title" | "artists" | "durationMs">,
  candidate: ApiCandidate,
): number {
  const wantedTitle = tokens(track.title);
  // PlayableTrack.artists is the display string ("Andreas Stone, Denniz Jamm")
  const wantedArtist = tokens(track.artists);
  const haveTitle = tokens(candidate.title);
  const haveArtist = tokens(candidate.artist);

  const titleScore = Math.max(
    tokenCoverage(wantedTitle, haveTitle),
    // candidate titles often embed the artist ("JD Smith - Flashback")
    tokenCoverage(wantedTitle, [...haveTitle, ...haveArtist]),
    // ...or the title arrives space-mangled ("Blacksunrise" vs "Black Sunrise")
    compactTitleScore(track.title, `${candidate.title} ${candidate.artist}`),
  );
  const artistScore = wantedArtist.length
    ? Math.max(
        tokenCoverage(wantedArtist, [...haveArtist, ...haveTitle]),
        compactTitleScore(track.artists, `${candidate.artist} ${candidate.title}`),
      )
    : 0.75; // no artist metadata to compare — don't punish the candidate

  if (titleScore < 0.6) return 0;
  if (wantedArtist.length && artistScore < 0.5) return 0;

  const duration = durationScore(track.durationMs, candidate.durationMs);
  // both lengths known and far apart -> a different recording (mix/live cut)
  if (track.durationMs && candidate.durationMs && duration === 0) return 0;
  return titleScore * 2 + artistScore + duration;
}

export function pickBestStandIn(
  track: Pick<PlayableTrack, "title" | "artists" | "durationMs">,
  candidates: ApiCandidate[],
): SoundCloudStandInMatch | null {
  let best: SoundCloudStandInMatch | null = null;
  for (const candidate of candidates) {
    const score = scoreStandInCandidate(track, candidate);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = {
        trackId: candidate.id,
        title: candidate.title,
        artist: candidate.artist,
        durationMs: candidate.durationMs,
        score,
      };
    }
  }
  return best;
}

export function standInQuery(track: Pick<PlayableTrack, "title" | "artists">): string {
  // artists is the display string ("A, B") — keep the first two names
  const artists = track.artists
    .split(/[,/&]\s*/)
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 2);
  return [track.title, ...artists].filter(Boolean).join(" ").slice(0, 120);
}

async function searchStandInCandidates(
  query: string,
  options: { signal?: AbortSignal },
): Promise<ApiCandidate[]> {
  const body = await getJson("/search/tracks", { q: query, limit: "12" }, options.signal);
  const raw = asArray(body.collection);
  return raw
    .map(mapSoundCloudCatalogTrack)
    .filter((mapped): mapped is NonNullable<typeof mapped> => mapped !== null)
    .map((mapped) => ({
      // mapped.id keeps the "sc:" prefix that resolveSoundCloudStream parses
      id: mapped.id,
      title: mapped.title,
      artist: mapped.artists.map((a) => a.name).join(" "),
      durationMs: mapped.durationMs,
    }));
}

export async function resolveSoundCloudStandIn(
  track: PlayableTrack,
  options: { signal?: AbortSignal } = {},
): Promise<ResolvedSoundCloudStream> {
  const query = standInQuery(track);
  log("cyan", "playback", `searching soundcloud stand-in for "${track.title}"`);
  // the full "title artists" query can whiff on SoundCloud's search ranking
  // (long queries drift away from the upload, imported titles carry extra
  // words) — retry with the bare title before giving up, the scorer still
  // gates whatever comes back
  let candidates: ApiCandidate[] = [];
  try {
    candidates = await searchStandInCandidates(query, options);
  } catch (error) {
    if (options.signal?.aborted) throw error;
  }
  let best = candidates.length ? pickBestStandIn(track, candidates) : null;
  const titleQuery = track.title.trim().slice(0, 120);
  if (!best && titleQuery && titleQuery !== query) {
    log("yellow", "playback", `stand-in retry with title only: "${titleQuery}"`);
    try {
      candidates = await searchStandInCandidates(titleQuery, options);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      candidates = [];
    }
    best = candidates.length ? pickBestStandIn(track, candidates) : null;
  }
  if (!candidates.length) throw new Error("SoundCloud: no search results.");
  if (!best) throw new Error("SoundCloud: no confident match found.");
  log(
    "cyan",
    "playback",
    `soundcloud stand-in match: "${best.title}" by ${best.artist} (score ${best.score.toFixed(2)})`,
  );
  return resolveSoundCloudStream(best.trackId, { signal: options.signal });
}
