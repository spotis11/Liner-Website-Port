// Music-video stream resolution for the fullscreen player's video backdrop
// (evi 0.1.29's "video thing": songs that ship with an official music video
// play the clip behind the lyrics — muted, frame-synced to the audio).
//
// evi carries `has_video` / `video_url` on the track row and decodes H.264
// with an embedded OpenH264 build. Liner's rows already say they are official
// music videos (Track.audioVariant "music-video") and the video id IS the
// track id, so the same innertube player request that yields the audio
// formats yields the video formats too — no second endpoint, just a wider
// filter (mimeType video/ instead of audio/).
//
// The pick is deliberately modest: H.264 MP4 (native decode in every browser,
// cheapest power draw), capped at 720p — the layer sits under the black/40
// scrim and the lyrics, where higher resolutions buy nothing.

import { InnertubeError, postInnertube } from "./innertubeClient";
import type { InnertubeProfile } from "./innertubeClient";
import { getWebPlayer } from "./webRemixAudio";
import { PLAYBACK_PROFILES } from "./playbackProfiles";
import { assertStreamReachable, isBotCheckRefusal } from "./streamProbe";
import { resetClientVisitorData } from "../session/visitorSession";
import {
  expiryFromUrl,
  playabilityError,
  requiresBotCheck,
} from "./innertubeAudioFormats";
import { formatStreamUrl, playerBody } from "./profileAudio";
import { asArray, asRecord } from "@/shared/utils/json";

export interface VideoFormat {
  itag: number;
  url: string;
  mimeType: string;
  bitrate: number;
  width?: number;
  height?: number;
  contentLength?: number;
  signatureCipher?: string;
}

export interface ResolvedVideoStream {
  url: string;
  mimeType: string;
  itag: number;
  width?: number;
  height?: number;
  expiresAt: string | null;
  contentLength?: number;
}

/** backdrop ceiling — the scrim + lyrics sit on top of the layer anyway */
const MAX_BACKDROP_HEIGHT = 720;

function toVideoFormat(raw: unknown): VideoFormat | null {
  const format = asRecord(raw);
  if (!format) return null;
  const { itag, mimeType } = format;
  const url = typeof format.url === "string" ? format.url : "";
  const signatureCipher =
    typeof format.signatureCipher === "string"
      ? format.signatureCipher
      : undefined;
  if (
    typeof itag !== "number" ||
    typeof mimeType !== "string" ||
    (!url && !signatureCipher)
  )
    return null;
  if (!mimeType.startsWith("video/")) return null;
  const bitrate = typeof format.bitrate === "number" ? format.bitrate : 0;
  const height = typeof format.height === "number" ? format.height : undefined;
  const width = typeof format.width === "number" ? format.width : undefined;
  const contentLength = Number(format.contentLength);
  return {
    itag,
    url,
    mimeType,
    bitrate,
    ...(height ? { height } : {}),
    ...(width ? { width } : {}),
    ...(Number.isFinite(contentLength) && contentLength > 0
      ? { contentLength }
      : {}),
    ...(signatureCipher ? { signatureCipher } : {}),
  };
}

export function extractVideoFormats(playerResponse: unknown): VideoFormat[] {
  const streamingData = asRecord(asRecord(playerResponse)?.streamingData);
  return [
    ...asArray(streamingData?.adaptiveFormats),
    ...asArray(streamingData?.formats),
  ]
    .map(toVideoFormat)
    .filter((format): format is VideoFormat => Boolean(format));
}

// H.264 MP4 first (native decode, cheapest); inside a codec the sharpest
// variant that stays within the cap wins, and when everything overshoots the
// cap the smallest overshoot keeps the decode sane.
export function selectBestVideoFormat(
  formats: VideoFormat[],
): VideoFormat | null {
  if (formats.length === 0) return null;
  const mp4 = formats.filter((format) => format.mimeType.includes("mp4"));
  const pool = mp4.length > 0 ? mp4 : formats;
  const withinCap = pool.filter(
    (format) => format.height != null && format.height <= MAX_BACKDROP_HEIGHT,
  );
  const group = withinCap.length > 0 ? withinCap : pool;
  return [...group].sort((a, b) =>
    withinCap.length > 0
      ? (b.height ?? 0) - (a.height ?? 0)
      : (a.height ?? 0) - (b.height ?? 0),
  )[0] ?? null;
}

async function resolveWithProfileVideo(
  videoId: string,
  profile: InnertubeProfile,
  signal?: AbortSignal,
): Promise<ResolvedVideoStream> {
  const player = profile.requiresJsPlayer ? await getWebPlayer() : null;
  const request = () =>
    postInnertube("player", playerBody(videoId, player), { profile, signal });
  let response = await request();
  if (requiresBotCheck(response)) {
    resetClientVisitorData();
    response = await request();
  }
  const unplayable = playabilityError(response);
  if (unplayable) throw new InnertubeError(unplayable, 403);
  const formats = extractVideoFormats(response).filter(
    (format) => player || format.url,
  );
  const best = selectBestVideoFormat(formats);
  if (!best)
    throw new InnertubeError(
      `${profile.clientName} returned no direct video formats.`,
      502,
    );
  const url = await formatStreamUrl(best, player);
  if (!url)
    throw new InnertubeError(
      `${profile.clientName} video stream url could not be deciphered.`,
      502,
    );
  const stream: ResolvedVideoStream = {
    url,
    mimeType: best.mimeType.split(";")[0]?.trim() || "video/mp4",
    itag: best.itag,
    expiresAt: expiryFromUrl(url),
    ...(best.height ? { height: best.height } : {}),
    ...(best.width ? { width: best.width } : {}),
    ...(best.contentLength ? { contentLength: best.contentLength } : {}),
  };
  await assertStreamReachable(stream.url, stream.contentLength, signal);
  return stream;
}

// Resolved URLs carry their own expiry (`expire=` param). Cache per video id
// until five minutes before that expiry so re-opening the fullscreen player
// never re-pays the player request for the same song.
const VIDEO_CACHE_SAFETY_MS = 5 * 60 * 1000;
const VIDEO_CACHE_DEFAULT_MS = 60 * 60 * 1000;

const videoCache = new Map<
  string,
  { stream: ResolvedVideoStream; goodUntil: number }
>();

/** @internal test hook */
export function resetVideoStreamCacheForTests(): void {
  videoCache.clear();
}

export async function resolveVideoStream(
  videoId: string,
  options: { signal?: AbortSignal } = {},
): Promise<ResolvedVideoStream> {
  const cached = videoCache.get(videoId);
  if (cached && Date.now() < cached.goodUntil) return cached.stream;

  const failures: string[] = [];
  let refused = 0;
  for (const profile of PLAYBACK_PROFILES) {
    try {
      const stream = await resolveWithProfileVideo(
        videoId,
        profile,
        options.signal,
      );
      const goodUntil = stream.expiresAt
        ? new Date(stream.expiresAt).getTime() - VIDEO_CACHE_SAFETY_MS
        : Date.now() + VIDEO_CACHE_DEFAULT_MS;
      videoCache.set(videoId, {
        stream,
        goodUntil: Math.max(goodUntil, Date.now() + 60_000),
      });
      return stream;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${profile.clientName}: ${message}`);
      if (isBotCheckRefusal(error)) refused += 1;
    }
  }
  throw new InnertubeError(
    `Video backdrop resolution failed (${failures.join("; ")}).`,
    refused === PLAYBACK_PROFILES.length ? 403 : 502,
  );
}
