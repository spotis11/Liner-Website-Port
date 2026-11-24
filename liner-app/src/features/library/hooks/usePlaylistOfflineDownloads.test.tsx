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

const track = (id: string): Track =>
  ({
    id,
    title: `Track ${id}`,
    artists: "Artist",
    coverUrl: "",
    durationMs: 200_000,
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
    const tracks = [track("t-1"), track("t-2")];
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
});
