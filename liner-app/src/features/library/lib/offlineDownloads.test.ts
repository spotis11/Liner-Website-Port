import { describe, it, expect, vi, beforeEach } from "vitest";

const resolvePlaybackStream = vi.fn();
const downloadAudioBytes = vi.fn();
const saveAudioBlob = vi.fn();
const isCached = vi.fn((id: string) => false);
const putTrack = vi.fn();
const setAudioPinned = vi.fn();

vi.mock("@/features/player/engine/streamResolver", () => ({
  resolvePlaybackStream,
}));
vi.mock("@/shared/youtube/innertube/chunkedAudioDownload", () => ({
  downloadAudioBytes,
}));
vi.mock("@/shared/storage/audioFormat", () => ({
  isStandaloneAudioFile: vi.fn(() => true),
}));
vi.mock("@/shared/media/liner/linerPlayback", () => ({
  markLinerStreamFailed: vi.fn(),
}));
vi.mock("@/shared/media/saved", () => ({
  isSavedTrack: vi.fn((id: string) => id.startsWith("sv_")),
}));
vi.mock("@/shared/storage/audioCache", () => ({
  audioCache: {
    currentGeneration: vi.fn(() => 1),
    saveAudioBlob,
    isCached,
  },
}));
vi.mock("@/shared/storage/linerDb", () => ({
  linerDb: {
    putTrack,
    setAudioPinned,
  },
}));

type QueueModule = typeof import("./offlineDownloads");

async function freshQueue(): Promise<QueueModule> {
  vi.resetModules();
  return import("./offlineDownloads");
}

const track = (id: string, durationMs = 200_000) => ({
  id,
  title: `Track ${id}`,
  artists: "Artist",
  coverUrl: "",
  durationMs,
  playCount: 0,
});

function okStream() {
  return Promise.resolve({
    url: "https://media.example/stream",
    mimeType: "audio/webm",
    contentLength: 10,
  });
}

describe("offline download queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isCached.mockReturnValue(false);
    saveAudioBlob.mockResolvedValue(true);
    putTrack.mockResolvedValue(undefined);
    setAudioPinned.mockResolvedValue(undefined);
  });

  it("skips cached, saved-device and >20min tracks and queues the rest", async () => {
    const { offlineDownloadQueue } = await freshQueue();
    isCached.mockImplementation((id: string) => id === "t-cached");
    const added = offlineDownloadQueue.enqueuePlaylist([
      track("t-1"),
      track("t-cached"),
      track("sv_1"),
      track("t-long", 30 * 60 * 1000),
      track("t-2"),
    ]);
    expect(added).toBe(true);
    const snap = offlineDownloadQueue.getSnapshot();
    expect(snap.done + snap.downloading + snap.queued).toBeGreaterThanOrEqual(2);
    expect(offlineDownloadQueue.stateOf("t-cached")).toBe("cached");
    expect(offlineDownloadQueue.stateOf("sv_1")).toBe(null);
    expect(offlineDownloadQueue.stateOf("t-long")).toBe(null);
    // re-enqueueing the same list must not double-queue
    expect(
      offlineDownloadQueue.enqueuePlaylist([track("t-1"), track("t-2")]),
    ).toBe(false);
  });

  it("downloads, stores and pins every queued track", async () => {
    const { offlineDownloadQueue } = await freshQueue();
    resolvePlaybackStream.mockImplementation(okStream);
    downloadAudioBytes.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    offlineDownloadQueue.enqueuePlaylist([track("t-ok")]);
    await vi.waitFor(() => {
      expect(offlineDownloadQueue.stateOf("t-ok")).toBe("done");
    });
    expect(saveAudioBlob).toHaveBeenCalledTimes(1);
    expect(putTrack).toHaveBeenCalledTimes(1);
    // the pin is what keeps the download out of the LRU eviction
    expect(setAudioPinned).toHaveBeenCalledWith("t-ok", true);
    const snap = offlineDownloadQueue.getSnapshot();
    expect(snap.done).toBe(1);
    expect(snap.error).toBe(0);
  });

  it("marks a track as error when the stream fails and keeps others going", async () => {
    const { offlineDownloadQueue } = await freshQueue();
    resolvePlaybackStream.mockImplementation((t: { id: string }) =>
      t.id === "t-bad"
        ? Promise.reject(new Error("resolve failed"))
        : okStream(),
    );
    downloadAudioBytes.mockResolvedValue(new Uint8Array([9]));
    offlineDownloadQueue.enqueuePlaylist([track("t-bad"), track("t-good")]);
    await vi.waitFor(() => {
      expect(offlineDownloadQueue.stateOf("t-good")).toBe("done");
    });
    expect(offlineDownloadQueue.stateOf("t-bad")).toBe("error");
    const snap = offlineDownloadQueue.getSnapshot();
    expect(snap.error).toBe(1);
    expect(snap.done).toBe(1);
    // a failed track must not be pinned
    expect(setAudioPinned).not.toHaveBeenCalledWith("t-bad", true);
  });

  it("never runs more than two downloads at once", async () => {
    const { offlineDownloadQueue } = await freshQueue();
    let inFlight = 0;
    let peak = 0;
    resolvePlaybackStream.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return { url: "https://media.example/s", mimeType: "audio/webm" };
    });
    downloadAudioBytes.mockResolvedValue(new Uint8Array([1]));
    offlineDownloadQueue.enqueuePlaylist([
      track("a"),
      track("b"),
      track("c"),
      track("d"),
      track("e"),
    ]);
    await vi.waitFor(() => {
      expect(offlineDownloadQueue.getSnapshot().done).toBe(5);
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("resetFinished clears done/error states so a re-visit retries failures", async () => {
    const { offlineDownloadQueue } = await freshQueue();
    resolvePlaybackStream.mockRejectedValue(new Error("offline?"));
    offlineDownloadQueue.enqueuePlaylist([track("t-fail")]);
    await vi.waitFor(() => {
      expect(offlineDownloadQueue.stateOf("t-fail")).toBe("error");
    });
    offlineDownloadQueue.resetFinished();
    expect(offlineDownloadQueue.stateOf("t-fail")).toBe(null);
  });

  it("getSnapshot returns a stable reference until the version changes (React #185)", async () => {
    const { offlineDownloadQueue } = await freshQueue();
    // a hung download freezes the queue in "downloading" so nothing else mutates
    resolvePlaybackStream.mockImplementation(() => new Promise(() => {}));
    offlineDownloadQueue.enqueuePlaylist([track("t-stable")]);
    const first = offlineDownloadQueue.getSnapshot();
    // useSyncExternalStore compares snapshots with Object.is — a fresh object
    // per call made React loop re-rendering forever on every playlist page
    // (minified React error #185, maximum update depth exceeded)
    expect(offlineDownloadQueue.getSnapshot()).toBe(first);
    expect(first.downloading + first.queued).toBe(1);
    offlineDownloadQueue.enqueuePlaylist([track("t-stable-2")]);
    const second = offlineDownloadQueue.getSnapshot();
    expect(second).not.toBe(first);
    expect(second.version).toBeGreaterThan(first.version);
    expect(offlineDownloadQueue.getSnapshot()).toBe(second);
  });

  it("aborts a hung download at the deadline and marks it failed", async () => {
    const { offlineDownloadQueue, DOWNLOAD_TIMEOUT_MS } = await freshQueue();
    resolvePlaybackStream.mockImplementation(
      (_t: unknown, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    vi.useFakeTimers();
    offlineDownloadQueue.enqueuePlaylist([track("t-hang")]);
    await vi.advanceTimersByTimeAsync(DOWNLOAD_TIMEOUT_MS + 500);
    expect(offlineDownloadQueue.stateOf("t-hang")).toBe("error");
    vi.useRealTimers();
  });

  it("drops the queue state when the save is rejected (no dangling downloading)", async () => {
    const { offlineDownloadQueue } = await freshQueue();
    resolvePlaybackStream.mockImplementation(okStream);
    downloadAudioBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    saveAudioBlob.mockResolvedValue(false);
    offlineDownloadQueue.enqueuePlaylist([track("t-reject")]);
    await vi.waitFor(() => {
      expect(offlineDownloadQueue.getSnapshot().downloading).toBe(0);
    });
    expect(offlineDownloadQueue.stateOf("t-reject")).toBe(null);
  });
});
