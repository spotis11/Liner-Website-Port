import { resolvePlaybackStream } from "@/features/player/engine/streamResolver";
import { downloadAudioBytes } from "@/shared/youtube/innertube/chunkedAudioDownload";
import { isStandaloneAudioFile } from "@/shared/storage/audioFormat";
import { markLinerStreamFailed } from "@/shared/media/liner/linerPlayback";
import { isSavedTrack } from "@/shared/media/saved";
import { audioCache } from "@/shared/storage/audioCache";
import { linerDb } from "@/shared/storage/linerDb";
import type { Track } from "@/shared/types";

/**
 * Whole-playlist offline downloads — the engine behind the "all songs are
 * downloaded automatically once I visit a playlist" behaviour. Tracks are
 * queued, resolved and stored as pinned audio blobs (never evicted by the
 * LRU cache limit) so the player finds them offline via its normal
 * cached-audio path.
 *
 * The queue is deliberately page-driven: visiting a playlist enqueues its
 * tracks, downloads run 2-at-a-time while the tab stays open (no background
 * sync), and everything already cached is skipped. Errors are per-track and
 * retried on the next visit.
 */

export type OfflineDownloadState = "queued" | "downloading" | "done" | "error";

export interface OfflineQueueSnapshot {
  /** monotonically increasing change counter (useSyncExternalStore friend) */
  version: number;
  downloading: number;
  queued: number;
  done: number;
  error: number;
  /** ids currently downloading or waiting */
  activeIds: string[];
}

const CONCURRENCY = 2;
const MAX_TRACK_MS = 20 * 60 * 1000;
// a stalled socket must not hold one of the two concurrency slots forever —
// the abort marks the track failed so the next visit retries it
export const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

class OfflineDownloadQueue {
  private states = new Map<string, OfflineDownloadState>();
  private order: string[] = [];
  private tracks = new Map<string, Track>();
  private running = 0;
  private generation = 0;
  private version = 0;
  // useSyncExternalStore contract: getSnapshot MUST return the same object
  // reference until the store actually changes — a fresh object per call
  // makes React see a "changed" snapshot on every render and loop forever
  // (minified React error #185, maximum update depth exceeded).
  private snapshot: OfflineQueueSnapshot | null = null;
  private listeners = new Set<() => void>();
  private online = typeof navigator === "undefined" ? true : navigator.onLine;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
    }
  }

  private handleOnline = () => {
    this.online = true;
    this.pump();
  };

  private handleOffline = () => {
    this.online = false;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): OfflineQueueSnapshot => {
    const cached = this.snapshot;
    if (cached && cached.version === this.version) return cached;
    let downloading = 0;
    let queued = 0;
    let done = 0;
    let error = 0;
    const activeIds: string[] = [];
    for (const id of this.order) {
      const state = this.states.get(id);
      if (state === "downloading") {
        downloading += 1;
        activeIds.push(id);
      } else if (state === "queued") {
        queued += 1;
        activeIds.push(id);
      } else if (state === "done") done += 1;
      else if (state === "error") error += 1;
    }
    const fresh: OfflineQueueSnapshot = {
      version: this.version,
      downloading,
      queued,
      done,
      error,
      activeIds,
    };
    this.snapshot = fresh;
    return fresh;
  };

  private notify() {
    this.version += 1;
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      for (const listener of this.listeners) listener();
    }, 250);
  }

  stateOf(trackId: string): OfflineDownloadState | "cached" | null {
    const state = this.states.get(trackId);
    if (state) return state;
    return audioCache.isCached(trackId) ? "cached" : null;
  }

  /**
   * Queue a playlist's tracks for pinned offline download. Cached and
   * ineligible tracks are dropped here, so re-visiting a playlist only
   * downloads what is missing.
   */
  enqueuePlaylist(tracks: Track[]) {
    let added = false;
    for (const track of tracks) {
      if (!track?.id || isSavedTrack(track.id)) continue;
      if (track.durationMs && track.durationMs > MAX_TRACK_MS) continue;
      if (this.states.has(track.id)) continue;
      if (audioCache.isCached(track.id)) continue;
      this.states.set(track.id, "queued");
      this.tracks.set(track.id, track);
      this.order.push(track.id);
      added = true;
    }
    if (added) {
      this.notify();
      this.pump();
    }
    return added;
  }

  private pump() {
    if (!this.online) return;
    while (this.running < CONCURRENCY) {
      const next = this.order.find((id) => this.states.get(id) === "queued");
      if (!next) return;
      this.start(next);
    }
  }

  private start(trackId: string) {
    const track = this.tracks.get(trackId);
    if (!track) {
      this.states.delete(trackId);
      return;
    }
    this.running += 1;
    this.states.set(trackId, "downloading");
    this.notify();
    const controller = new AbortController();
    const deadline = setTimeout(
      () =>
        controller.abort(
          new Error(
            `offline download timed out after ${DOWNLOAD_TIMEOUT_MS / 60000} min`,
          ),
        ),
      DOWNLOAD_TIMEOUT_MS,
    );
    void this.download(track, controller)
      .catch(() => this.states.set(trackId, "error"))
      .finally(() => {
        clearTimeout(deadline);
        this.running -= 1;
        this.tracks.delete(trackId);
        this.notify();
        this.pump();
      });
  }

  private async download(
    track: Track,
    controller: AbortController,
  ): Promise<void> {
    const generation = audioCache.currentGeneration();
    const stream = await resolvePlaybackStream(track, controller.signal, {
      progressive: true,
    });
    const blob = await this.fetchBlob(stream, controller.signal);
    if (!blob) throw new Error("no audio bytes");
    if (generation !== audioCache.currentGeneration()) return;
    const saved = await audioCache.saveAudioBlob(
      track.id,
      blob,
      blob.type,
      generation,
    );
    if (!saved) {
      // the cache was cleared/re-armed mid-download — drop the state instead
      // of leaving a dangling "downloading" that blocks the badge forever
      this.states.delete(track.id);
      return;
    }
    await linerDb.putTrack(track);
    // pinned downloads survive the LRU cache limit — this is what makes the
    // playlist "downloaded" rather than just cached
    await linerDb.setAudioPinned(track.id, true);
    this.states.set(track.id, "done");
  }

  private async fetchBlob(
    stream: Awaited<ReturnType<typeof resolvePlaybackStream>>,
    signal: AbortSignal,
  ): Promise<Blob | null> {
    if (stream.blob) return stream.blob;
    if (stream.completed) return stream.completed;
    let bytes: Awaited<ReturnType<typeof downloadAudioBytes>>;
    try {
      bytes = await downloadAudioBytes(stream.url, {
        contentLength: stream.contentLength,
        signal,
      });
    } catch (error) {
      if (stream.fromLiner && !signal.aborted)
        markLinerStreamFailed(`offline download: ${String(error)}`);
      throw error;
    }
    if (!bytes || signal.aborted) return null;
    const mimeType = stream.mimeType || "audio/webm";
    if (!mimeType.startsWith("audio/") && !mimeType.startsWith("video/"))
      return null;
    if (!isStandaloneAudioFile(bytes.subarray(0, 16))) return null;
    return new Blob([bytes], { type: mimeType });
  }

  /** drop finished/failed entries so a re-visit re-evaluates cleanly */
  resetFinished() {
    let changed = false;
    for (const [id, state] of this.states) {
      if (state === "done" || state === "error") {
        this.states.delete(id);
        changed = true;
      }
    }
    this.order = this.order.filter((id) => {
      const state = this.states.get(id);
      return state === "queued" || state === "downloading";
    });
    if (changed) this.notify();
  }
}

export const offlineDownloadQueue = new OfflineDownloadQueue();
