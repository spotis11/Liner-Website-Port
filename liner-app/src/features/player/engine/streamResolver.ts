import {
  isYoutubeSignedIn,
  prefersAccountPlayback,
  resolveDirectAudioStream,
  openTvAudioStream,
  resolveTvAudioStream,
  toVideoId,
} from "@/shared/youtube";
import {
  resolveSoundCloudStream,
  toSoundCloudTrackId,
} from "@/shared/media/soundcloud";
import { resolveLinerStream } from "@/shared/media/liner/linerPlayback";
import { isAbortError } from "@/shared/utils/abort";
import { log } from "@/shared/utils/logger";
import {
  fromInnertubeStream,
  fromLinerStream,
  fromSoundCloudStream,
  fromTvProgressiveStream,
  fromTvStream,
  type PlayableTrack,
  type PlaybackStream,
} from "./playbackStream";
import { findYoutubeStandIn } from "./youtubeStandIn";
import { localMusicDb } from "@/features/local-music/lib/localMusicDb";
import {
  recordPlaybackFailure,
  recordPlaybackSuccess,
} from "@/shared/diagnostics/playbackDiagnostics";
import { resolveSoundCloudStandIn } from "./soundcloudStandIn";
import { withDeadline } from "@/shared/utils/withDeadline";
import { usePlayerStore } from "../store/playerStore";

export interface ResolveStreamOptions {
  progressive?: boolean;
}

// A hung resolution stage (TV bootstrap, player request, SABR handshake,
// liner cache probe ...) previously kept the player in "loading" forever AND
// silently skipped the SoundCloud rescue below, because that rescue only runs
// from the catch path. The deadline turns a hang into a normal error so the
// rescue chain actually gets its chance; the runtime-level watchdog in
// playerRuntime stays as the outer backstop.
const RESOLVE_TIMEOUT_MS = 30_000;
const STANDIN_TIMEOUT_MS = 15_000;

export class ResolveTimeoutError extends Error {
  constructor(ms: number) {
    super(
      `Timed out resolving audio after ${Math.round(ms / 1000)}s — trying fallbacks.`,
    );
    this.name = "ResolveTimeoutError";
  }
}

export type {
  BufferedPlaybackStream,
  PlayableTrack,
  PlaybackStream,
  UrlPlaybackStream,
} from "./playbackStream";

async function resolveTvAudio(
  videoId: string,
  progressive: boolean,
  signal?: AbortSignal,
): Promise<PlaybackStream> {
  if (progressive)
    return fromTvProgressiveStream(
      await openTvAudioStream(videoId, { signal }),
    );
  return fromTvStream(await resolveTvAudioStream(videoId, { signal }));
}

async function resolveYoutubeAudio(
  videoId: string,
  progressive: boolean,
  signal?: AbortSignal,
  trackTitle?: string,
): Promise<PlaybackStream> {
  if (isYoutubeSignedIn() && prefersAccountPlayback()) {
    try {
      const stream = await resolveTvAudio(videoId, progressive, signal);
      log("cyan", "playback", `playing youtube tv audio for ${videoId}`);
      recordPlaybackSuccess("played", "youtube tv audio", trackTitle ?? videoId);
      return stream;
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      log("yellow", "playback", `youtube tv playback failed: ${String(error)}`);
      recordPlaybackFailure("tv", error, trackTitle ?? videoId);
    }
  }
  const stream = await resolveDirectAudioStream(videoId, { signal });
  recordPlaybackSuccess("played", "innertube direct", trackTitle ?? videoId);
  return fromInnertubeStream(stream);
}

async function resolveYoutubeStandIn(
  track: PlayableTrack,
  progressive: boolean,
  signal?: AbortSignal,
): Promise<PlaybackStream> {
  const videoId = await findYoutubeStandIn(track, signal);
  if (!videoId) throw new Error("No matching YouTube track found");
  log(
    "cyan",
    "playback",
    `playing youtube stand-in ${videoId} for "${track.title}"`,
  );
  return resolveYoutubeAudio(videoId, progressive, signal);
}

async function resolveSoundCloud(
  track: PlayableTrack,
  progressive: boolean,
  signal?: AbortSignal,
): Promise<PlaybackStream> {
  try {
    return fromSoundCloudStream(
      await resolveSoundCloudStream(track.id, { signal }),
    );
  } catch (soundCloudError) {
    if (isAbortError(soundCloudError, signal)) throw soundCloudError;
    log(
      "yellow",
      "playback",
      `soundcloud resolution failed, searching youtube: ${String(soundCloudError)}`,
    );
    try {
      return await resolveYoutubeStandIn(track, progressive, signal);
    } catch (standInError) {
      if (isAbortError(standInError, signal)) throw standInError;
      throw soundCloudError;
    }
  }
}

async function resolveYoutubeTrack(
  track: PlayableTrack,
  videoId: string,
  progressive: boolean,
  signal?: AbortSignal,
): Promise<PlaybackStream> {
  const liner = await resolveLinerStream(videoId, signal);
  if (liner) {
    log("cyan", "playback", `playing liner audio (r2) for "${track.title}"`);
    recordPlaybackSuccess("played", "liner audio (r2)", track.title);
    return fromLinerStream(liner, track);
  }
  return resolveYoutubeAudio(videoId, progressive, signal, track.title);
}

export async function resolvePlaybackStream(
  track: PlayableTrack,
  signal?: AbortSignal,
  options: ResolveStreamOptions = {},
): Promise<PlaybackStream> {
  // local library files never touch the network — serve the stored blob
  if (track.localFileId) {
    const record = await localMusicDb.getFile(track.localFileId);
    if (record?.blob) {
      recordPlaybackSuccess("played", "local file", track.title);
      return {
        blob: record.blob,
        expiresAtMs: null,
        mimeType: record.type || "audio/mpeg",
        codec: record.type || "local",
        bitrate: 0,
      };
    }
    recordPlaybackFailure(
      "unresolved",
      new Error("local file missing from IndexedDB"),
      track.title,
    );
    throw new Error(
      `"${track.title}" is no longer in your local library — rescan your folders.`,
    );
  }

  // bound every stage inside resolvePlaybackStreamInner; abort the in-flight
  // work when the deadline fires so sockets don't linger
  const innerController = new AbortController();
  const onOuterAbort = () => innerController.abort(signal?.reason);
  signal?.addEventListener("abort", onOuterAbort, { once: true });
  let innerTimedOut = false;
  try {
    return await withDeadline(
      resolvePlaybackStreamInner(track, innerController.signal, options),
      RESOLVE_TIMEOUT_MS,
      () => {
        innerTimedOut = true;
        return new ResolveTimeoutError(RESOLVE_TIMEOUT_MS);
      },
    );
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    recordPlaybackFailure("unresolved", error, track.title);
    // last resort: the same song often exists on SoundCloud, which has no
    // datacenter bot-checks. Off by default only if the user turns it off.
    if (usePlayerStore.getState().soundcloudFallback && !toSoundCloudTrackId(track.id)) {
      try {
        const stream = fromSoundCloudStream(
          await withDeadline(
            resolveSoundCloudStandIn(track, { signal }),
            STANDIN_TIMEOUT_MS,
            () =>
              new Error(
                `SoundCloud stand-in timed out after ${Math.round(STANDIN_TIMEOUT_MS / 1000)}s.`,
              ),
          ),
        );
        recordPlaybackSuccess("played", "soundcloud stand-in", track.title);
        return stream;
      } catch (standInError) {
        if (isAbortError(standInError, signal)) throw standInError;
        recordPlaybackFailure("soundcloud_standin", standInError, track.title);
      }
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", onOuterAbort);
    if (innerTimedOut) innerController.abort();
  }
}

async function resolvePlaybackStreamInner(
  track: PlayableTrack,
  signal?: AbortSignal,
  options: ResolveStreamOptions = {},
): Promise<PlaybackStream> {
  const progressive = options.progressive ?? false;
  if (toSoundCloudTrackId(track.id)) {
    const stream = await resolveSoundCloud(track, progressive, signal);
    recordPlaybackSuccess("played", "soundcloud", track.title);
    return stream;
  }
  const videoId = toVideoId(track.id);
  if (videoId) return resolveYoutubeTrack(track, videoId, progressive, signal);
  return resolveYoutubeStandIn(track, progressive, signal);
}
