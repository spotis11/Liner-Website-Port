import { resolvePlaybackStream } from "@/features/player/engine/streamResolver";
import { downloadAudioBytes } from "@/shared/youtube/innertube/chunkedAudioDownload";
import { isStandaloneAudioFile } from "@/shared/storage/audioFormat";
import { linerDb, audioCache } from "@/shared/storage";
import type { Track } from "@/shared/types";
import { useDownloadsStore } from "../store/downloadsStore";

/** minimal metadata the manager needs to resolve + store a track */
export interface DownloadMeta {
  id: string;
  title: string;
  artists: string;
  coverUrl?: string;
  durationMs?: number;
}

// each download already fans out into 4 parallel range chunks internally, so
// two concurrent tracks keep the pipe saturated without starving playback
const MAX_CONCURRENT_DOWNLOADS = 2;

class DownloadManager {
  private queue: DownloadMeta[] = [];
  private queued = new Set<string>();
  private active = new Map<string, AbortController>();

  async downloadTrack(track: DownloadMeta): Promise<void> {
    if (!track.id || track.id.startsWith("local:")) return;
    const store = useDownloadsStore.getState();

    const existing = store.statuses[track.id];
    if (existing && (existing.status === "queued" || existing.status === "downloading"))
      return;
    if (existing?.status === "downloaded") return;

    const pinnedRecord = await linerDb.getAudio(track.id);
    if (pinnedRecord?.pinnedAt) {
      store.setStatus(track.id, { status: "downloaded" });
      return;
    }

    if (this.queued.has(track.id) || this.active.has(track.id)) return;

    this.queue.push(track);
    this.queued.add(track.id);
    store.setStatus(track.id, {
      status: "queued",
      title: track.title,
      artists: track.artists,
    });
    this.pump();
  }

  /**
   * Queue a whole collection (liked songs, a playlist, the queue, …) in one
   * tap. Tracks already downloaded (or already queued/active) are skipped, so
   * pressing it again only fetches what is missing. The existing queue pumps
   * everything through 2 concurrent downloads, keeping playback smooth.
   *
   * Returns how many tracks were newly queued (0 = nothing to do).
   */
  async downloadMany(tracks: DownloadMeta[]): Promise<number> {
    const store = useDownloadsStore.getState();
    if (store.hydrated === false) await store.hydrate();

    const candidates: DownloadMeta[] = [];
    const seen = new Set<string>();
    for (const track of tracks) {
      if (!track?.id || track.id.startsWith("local:")) continue;
      if (seen.has(track.id)) continue;
      seen.add(track.id);

      const status = useDownloadsStore.getState().statuses[track.id];
      if (
        status?.status === "downloaded" ||
        status?.status === "queued" ||
        status?.status === "downloading"
      ) {
        continue;
      }
      candidates.push(track);
    }
    if (candidates.length === 0) return 0;

    // statuses come from a once-per-session hydrate, so double-check the db
    // in parallel — a pinned record (download made before a refresh, another
    // tab) still counts as downloaded. One round-trip, instant even for
    // 1000-track libraries.
    const pinnedFlags = await Promise.all(
      candidates.map((track) =>
        linerDb
          .getAudio(track.id)
          .then((record) => Boolean(record?.pinnedAt))
          .catch(() => false),
      ),
    );

    const fresh: DownloadMeta[] = [];
    candidates.forEach((track, index) => {
      if (pinnedFlags[index]) {
        useDownloadsStore
          .getState()
          .setStatus(track.id, { status: "downloaded" });
      } else {
        fresh.push(track);
      }
    });

    for (const track of fresh) {
      await this.downloadTrack(track);
    }
    return fresh.length;
  }

  /** true while any track of the given ids is queued or downloading */
  isBusy(ids: string[]): boolean {
    const statuses = useDownloadsStore.getState().statuses;
    return ids.some(
      (id) =>
        statuses[id]?.status === "queued" ||
        statuses[id]?.status === "downloading",
    );
  }

  cancel(trackId: string): void {
    this.queue = this.queue.filter((item) => item.id !== trackId);
    this.queued.delete(trackId);
    this.active.get(trackId)?.abort();
    this.active.delete(trackId);
    useDownloadsStore.getState().clear(trackId);
  }

  async removeDownload(trackId: string): Promise<void> {
    this.cancel(trackId);
    await linerDb.setAudioPinned(trackId, false).catch(() => {});
    await linerDb.deleteAudio(trackId);
    audioCache.revokeTrackUrl(trackId);
    useDownloadsStore.getState().clear(trackId);
  }

  private pump(): void {
    while (
      this.active.size < MAX_CONCURRENT_DOWNLOADS &&
      this.queue.length > 0
    ) {
      const next = this.queue.shift()!;
      this.queued.delete(next.id);
      const controller = new AbortController();
      this.active.set(next.id, controller);
      void this.runOne(next, controller)
        .catch(() => {})
        .finally(() => {
          this.active.delete(next.id);
          this.pump();
        });
    }
  }

  private async runOne(
    track: DownloadMeta,
    controller: AbortController,
  ): Promise<void> {
    const store = useDownloadsStore.getState();
    const { signal } = controller;
    const startedAt = performance.now();

    try {
      store.setStatus(track.id, {
        status: "downloading",
        received: 0,
        title: track.title,
        artists: track.artists,
      });

      // same resolution path the preload cache uses — proven to yield
      // standalone audio blobs for youtube / soundcloud / liner-r2 sources
      const stream = await resolvePlaybackStream(
        {
          id: track.id,
          title: track.title,
          artists: track.artists,
          durationMs: track.durationMs ?? 0,
        },
        signal,
      );

      let blob: Blob | null = null;
      if ("blob" in stream && stream.blob) {
        blob = stream.blob;
      } else if ("completed" in stream && stream.completed) {
        blob = await stream.completed;
      } else if ("url" in stream && stream.url) {
        const bytes = await downloadAudioBytes(stream.url, {
          contentLength: stream.contentLength,
          signal,
          onProgress: (received, total) => {
            useDownloadsStore
              .getState()
              .patchProgress(track.id, received, total);
          },
        });
        if (bytes && signal.aborted) return;
        if (bytes) {
          const mimeType =
            stream.mimeType || "audio/webm";
          if (!mimeType.startsWith("audio/") && !mimeType.startsWith("video/"))
            throw new Error("unsupported audio format");
          if (!isStandaloneAudioFile(bytes.subarray(0, 16)))
            throw new Error("not a standalone audio stream");
          blob = new Blob([bytes], { type: mimeType });
        }
      }

      if (!blob || blob.size === 0)
        throw new Error("could not fetch the audio for this track");
      if (signal.aborted) return;

      // write first, pin second: pinned blobs are exempt from cache-limit
      // eviction, so the plain put (no LRU sweep) + pin pair is atomic enough
      await linerDb.putAudio(track.id, blob, blob.type || "audio/webm");
      await linerDb.setAudioPinned(track.id, true);
      await linerDb.putTrack({
        id: track.id,
        title: track.title,
        artists: track.artists,
        coverUrl: track.coverUrl,
        durationMs: track.durationMs ?? 0,
        playCount: 0,
      } as Track);

      store.setStatus(track.id, { status: "downloaded" });
      logDownloaded(track, blob, performance.now() - startedAt);
    } catch (error) {
      if (signal.aborted || (error as Error)?.name === "AbortError") {
        store.clear(track.id);
        return;
      }
      store.setStatus(track.id, {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

function logDownloaded(
  track: DownloadMeta,
  blob: Blob,
  elapsedMs: number,
): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(
      `[downloads] "${track.title}" ${Math.round(blob.size / 1024)} KB in ${Math.round(elapsedMs)}ms`,
    );
  }
}

export const downloadManager = new DownloadManager();
