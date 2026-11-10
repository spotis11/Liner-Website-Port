import {
  collectHomeFeedItems,
  fetchInnertubeHomeFeed,
  type HomeFeedItems,
} from "@/shared/youtube/innertube/innertubeHomeFeed";

// Shared, TTL-cached loader for the innertube home feed. Every home section
// hook falls back to this when the site backend has nothing (fresh visitor),
// so all of them must share one fetch — module-level memo keeps it to a single
// browse pair (initial + continuation) per TTL window. Track shelves are
// guaranteed by fetchInnertubeHomeFeed itself (charts fallback).
const TTL_MS = 10 * 60_000;

let cached: { at: number; items: HomeFeedItems } | null = null;
let inflight: Promise<HomeFeedItems> | null = null;

export function loadInnertubeHomeItems(): Promise<HomeFeedItems> {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return Promise.resolve(cached.items);
  }
  if (!inflight) {
    inflight = fetchInnertubeHomeFeed()
      .then((shelves) => {
        const items = collectHomeFeedItems(shelves);
        cached = { at: Date.now(), items };
        return items;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Test hook: drop the memoized feed (does not abort in-flight requests). */
export function resetInnertubeHomeCache(): void {
  cached = null;
}
