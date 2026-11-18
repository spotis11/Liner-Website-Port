import { useEffect, useSyncExternalStore } from "react";
import { api, getAuthSession, toClientTrack } from "@/shared/api";
import type { Track } from "@/shared/types";

type LikedData = { tracks: Track[]; total: number };
const EMPTY: LikedData = { tracks: [], total: 0 };
let cache: LikedData = EMPTY;
let loaded = false;
let fetchedFromServer = false;
let loadFailed = false;
let request: Promise<void> | null = null;
const listeners = new Set<() => void>();
let view = { data: cache, isLoading: true, error: false };

const optimisticOverrides = new Map<string, boolean>();

// --- durable liked-library cache (client half of account recovery) ---------
// Persisted after every successful server load so a wiped production
// database can be rebuilt from the browser (see authStore repushLikedLibrary).
const LIKED_CACHE_KEY = "liner_liked_cache_v1";
const LIKED_CACHE_MAX = 1000;

function persistLikedCache(tracks: Track[]): void {
  try {
    localStorage.setItem(
      LIKED_CACHE_KEY,
      JSON.stringify(tracks.slice(0, LIKED_CACHE_MAX)),
    );
  } catch {
    // storage full/disabled — recovery then simply has nothing to re-push
  }
}

/** The last server-verified liked library this browser saw (oldest last). */
export function readLikedCache(): Track[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(LIKED_CACHE_KEY) ?? "null");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is Track => !!t && typeof t === "object" && typeof (t as Track).id === "string" && typeof (t as Track).title === "string",
    );
  } catch {
    return [];
  }
}

function buildView(isLoading: boolean): {
  data: LikedData;
  isLoading: boolean;
  error: boolean;
} {
  const error = loadFailed;
  if (optimisticOverrides.size === 0) return { data: cache, isLoading, error };

  let tracks = cache.tracks.filter(
    (t) => optimisticOverrides.get(t.id) !== false,
  );
  for (const [id, liked] of optimisticOverrides) {
    if (liked && !tracks.some((t) => t.id === id)) {
      tracks = [
        {
          id,
          title: "",
          artists: "",
          artistId: undefined,
          coverUrl: "",
          durationMs: 0,
          playCount: 0,
        } as Track,
        ...tracks,
      ];
    }
  }
  return { data: { tracks, total: tracks.length }, isLoading, error };
}

function emit(isLoading = false) {
  view = buildView(isLoading);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot() {
  return view;
}

const SERVER_SNAPSHOT = { data: EMPTY, isLoading: true, error: false };

function load(force = false): Promise<void> {
  if (request) return request;
  const session = getAuthSession();
  if (!session?.accessToken) {
    cache = EMPTY;
    loaded = false;
    fetchedFromServer = false;
    emit(false);
    return Promise.resolve();
  }
  if (loaded && !force) return Promise.resolve();

  if (!loaded) emit(true);

  request = (async () => {
    const tracks: Track[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    let retriedCursor = false;
    do {
      let page: Awaited<ReturnType<typeof api.listLikedTracks>>;
      try {
        page = await api.listLikedTracks(100, cursor);
      } catch (error) {
        // one flaky page must not throw away an entire library: retry the
        // same cursor once before surfacing the failure
        if (!retriedCursor) {
          retriedCursor = true;
          await new Promise((resolve) => setTimeout(resolve, 400));
          continue;
        }
        throw error;
      }
      retriedCursor = false;
      for (const { track, likedAt } of page.items) {
        // items whose snapshot the server could not hydrate arrive with a
        // null/empty track — rendering them would produce blank rows that
        // all share the React key "" and collapse into one (the "I have 74
        // songs and most of them are not there" bug). Skip + count them.
        if (!track?.id) continue;
        if (seen.has(track.id)) continue;
        seen.add(track.id);
        tracks.push({
          ...toClientTrack(track),
          addedAt: likedAt,
        });
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    cache = { tracks, total: tracks.length };
    loaded = true;
    fetchedFromServer = true;
    loadFailed = false;
    optimisticOverrides.clear();
    persistLikedCache(tracks);
  })()
    .catch(() => {
      if (!fetchedFromServer) cache = EMPTY;
      loaded = fetchedFromServer;
      loadFailed = true;
    })
    .finally(() => {
      request = null;
      emit(false);
    });
  return request;
}

export function reloadLikedTracks(): Promise<void> {
  return load(true);
}

export function applyOptimisticLike(trackId: string): () => void {
  const prev = optimisticOverrides.get(trackId);
  optimisticOverrides.set(trackId, true);
  emit(false);
  return () => {
    if (prev === undefined) optimisticOverrides.delete(trackId);
    else optimisticOverrides.set(trackId, prev);
    emit(false);
  };
}

export function applyOptimisticUnlike(trackId: string): () => void {
  const prev = optimisticOverrides.get(trackId);
  optimisticOverrides.set(trackId, false);
  emit(false);
  return () => {
    if (prev === undefined) optimisticOverrides.delete(trackId);
    else optimisticOverrides.set(trackId, prev);
    emit(false);
  };
}

if (typeof window !== "undefined") {
  const handleRefresh = () => {
    const session = getAuthSession();
    if (!session?.accessToken) {
      cache = EMPTY;
      loaded = false;
      fetchedFromServer = false;
      optimisticOverrides.clear();
      emit(false);
    } else {
      void load(true);
    }
  };
  window.addEventListener("library:changed", handleRefresh);
  window.addEventListener("auth:changed", handleRefresh);
}

export const loadLikedTracks = load;
export const subscribeLikedTracks = subscribe;

export function likedTracksSnapshot(): {
  tracks: Track[];
  fromServer: boolean;
} {
  return { tracks: view.data.tracks, fromServer: fetchedFromServer };
}

export function useLikedTracks(_params?: { limit?: number; offset?: number }) {
  const state = useSyncExternalStore(
    subscribe,
    snapshot,
    () => SERVER_SNAPSHOT,
  );
  useEffect(() => {
    void load();
  }, []);
  return state;
}

export function useLikedTrackCount() {
  const { data, isLoading } = useLikedTracks();
  return { data: data.total, isLoading };
}
