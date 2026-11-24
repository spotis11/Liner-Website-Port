// @vitest-environment jsdom
// Regression: the offline-queue snapshot used by useSyncExternalStore must be
// reference-stable. A fresh object per getSnapshot() call made every playlist
// page (incl. liked songs) re-render forever — minified React error #185
// ("Maximum update depth exceeded") as reported from the desktop client.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { createRoot, Root } from "react-dom/client";
import { act } from "react";
import { usePlaylistOfflineDownloads } from "./usePlaylistOfflineDownloads";
import { offlineDownloadQueue } from "../lib/offlineDownloads";
import type { Track } from "@/shared/types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// factories must be self-contained: vi.mock is hoisted above the imports that
// pull the hook in, so nothing top-level may be referenced from a factory
vi.mock("@/shared/media/saved", () => ({
  isSavedTrack: vi.fn(() => false),
}));
vi.mock("@/shared/storage/audioCache", () => ({
  audioCache: {
    currentGeneration: vi.fn(() => 1),
    isCached: vi.fn(() => false),
    subscribeCachedIds: vi.fn(() => () => {}),
    whenCachedIdsReady: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock("@/features/player/engine/streamResolver", () => ({
  resolvePlaybackStream: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@/shared/youtube/innertube/chunkedAudioDownload", () => ({
  downloadAudioBytes: vi.fn(),
}));
vi.mock("@/shared/storage/audioFormat", () => ({
  isStandaloneAudioFile: vi.fn(() => true),
}));
vi.mock("@/shared/media/liner/linerPlayback", () => ({
  markLinerStreamFailed: vi.fn(),
}));
vi.mock("@/shared/storage/linerDb", () => ({
  linerDb: {
    putTrack: vi.fn(),
    setAudioPinned: vi.fn(),
    listAudioIds: vi.fn(async () => []),
  },
}));

const track = (id: string, durationMs = 200_000): Track =>
  ({
    id,
    title: `Track ${id}`,
    artists: "Artist",
    coverUrl: "",
    durationMs,
    playCount: 0,
  }) as unknown as Track;

describe("usePlaylistOfflineDownloads", () => {
  it("renders a bounded number of times — snapshot must be reference-stable", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    let renderCount = 0;
    const Probe = ({ tracks }: { tracks: Track[] }) => {
      const progress = usePlaylistOfflineDownloads(tracks);
      renderCount += 1;
      return <div>{progress ? String(progress.phase) : "none"}</div>;
    };
    // over the 20-minute cap: enqueue skips them, so the shared queue
    // singleton stays empty for the readiness test below
    const tracks = [track("t-long-1", 21 * 60 * 1000), track("t-long-2", 21 * 60 * 1000)];
    act(() => {
      root.render(<Probe tracks={tracks} />);
    });
    const afterMount = renderCount;
    // a parent-driven re-render: with the unstable getSnapshot this looped
    // synchronously until React threw "Maximum update depth exceeded" (#185)
    act(() => {
      root.render(<Probe tracks={tracks} />);
    });
    expect(renderCount).toBeLessThanOrEqual(afterMount + 3);
    act(() => {
      root.unmount();
    });
  });

  it("waits for the cached-id set before enqueueing — no re-downloads on revisit", async () => {
    const audioCacheMock = (await vi.importMock(
      "@/shared/storage/audioCache",
    )) as { audioCache: Record<string, ReturnType<typeof vi.fn>> };
    let release: (() => void) | undefined;
    audioCacheMock.audioCache.whenCachedIdsReady.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    // the liked tracks are already saved on disk from an earlier visit
    audioCacheMock.audioCache.isCached.mockReturnValue(true);
    const spy = vi.spyOn(offlineDownloadQueue, "enqueuePlaylist");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const Probe = ({ tracks }: { tracks: Track[] }) => {
      usePlaylistOfflineDownloads(tracks);
      return null;
    };
    const tracks = [track("t-1"), track("t-2")];
    act(() => {
      root.render(<Probe tracks={tracks} />);
    });
    // the cached-id set has not "loaded" yet — nothing may be enqueued,
    // otherwise already-saved tracks would be re-downloaded on every visit
    expect(spy).not.toHaveBeenCalled();
    await act(async () => {
      release?.();
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const snap = offlineDownloadQueue.getSnapshot();
    expect(snap.downloading + snap.queued).toBe(0);
    act(() => {
      root.unmount();
    });
  });
});
