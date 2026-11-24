import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { isSavedTrack } from "@classic/shared/media/saved";
import { audioCache } from "@classic/shared/storage/audioCache";
import {
  offlineDownloadQueue,
  type OfflineDownloadState,
} from "../lib/offlineDownloads";
import type { Track } from "@classic/shared/types";

const MAX_TRACK_MS = 20 * 60 * 1000;

export interface PlaylistOfflineProgress {
  /** eligible = not saved-to-device, not longer than 20 min */
  eligible: number;
  cached: number;
  downloading: number;
  queued: number;
  error: number;
  /** "downloading" | "done" | "partial-error" | null (nothing to do) */
  phase: "downloading" | "done" | "partial-error" | null;
}

/**
 * Auto-download a playlist's tracks for offline playback when the page
 * mounts (online only) and report progress for the header badge. Re-visits
 * only fetch what is missing; finished/failed entries reset so failures
 * retry on the next visit.
 */
export function usePlaylistOfflineDownloads(
  tracks: Track[] | undefined,
): PlaylistOfflineProgress | null {
  const ids = useMemo(
    () => (tracks ?? []).map((track) => track.id).join(","),
    [tracks],
  );
  const tracksRef = useRef<Track[]>([]);
  tracksRef.current = tracks ?? [];
  const [cacheEpoch, setCacheEpoch] = useState(0);

  // audioCache's cached-id set loads async — keep the badge in sync with it
  useEffect(() => audioCache.subscribeCachedIds(() => setCacheEpoch((e) => e + 1)), []);

  useEffect(() => {
    if (!ids) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    let cancelled = false;
    // the cached-id set loads async from IndexedDB — enqueueing before it is
    // ready makes every visit re-download tracks that are already on disk
    void audioCache.whenCachedIdsReady().then(() => {
      if (cancelled) return;
      offlineDownloadQueue.resetFinished();
      const byId = new Map(tracksRef.current.map((track) => [track.id, track]));
      offlineDownloadQueue.enqueuePlaylist(
        ids
          .split(",")
          .filter(Boolean)
          .map((id) => byId.get(id))
          .filter((track): track is Track => Boolean(track)),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [ids]);

  const snapshot = useSyncExternalStore(
    offlineDownloadQueue.subscribe,
    offlineDownloadQueue.getSnapshot,
    offlineDownloadQueue.getSnapshot,
  );

  return useMemo(() => {
    void snapshot.version;
    void cacheEpoch;
    if (!tracks?.length) return null;
    let eligible = 0;
    let cached = 0;
    let downloading = 0;
    let queued = 0;
    let error = 0;
    for (const track of tracks) {
      if (!track?.id || isSavedTrack(track.id)) continue;
      if (track.durationMs && track.durationMs > MAX_TRACK_MS) continue;
      eligible += 1;
      const state: OfflineDownloadState | "cached" | null =
        offlineDownloadQueue.stateOf(track.id);
      if (state === "cached" || state === "done") cached += 1;
      else if (state === "downloading") downloading += 1;
      else if (state === "queued") queued += 1;
      else if (state === "error") error += 1;
      else if (audioCache.isCached(track.id)) cached += 1;
    }
    if (eligible === 0) return null;
    const phase: PlaylistOfflineProgress["phase"] =
      downloading + queued > 0
        ? "downloading"
        : error > 0 && cached < eligible
          ? "partial-error"
          : cached >= eligible
            ? "done"
            : null;
    return { eligible, cached, downloading, queued, error, phase };
  }, [tracks, snapshot.version, cacheEpoch]);
}
