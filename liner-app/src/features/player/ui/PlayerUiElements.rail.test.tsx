import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Focused tests for the YouTube-Music-style Song/Video toggle in the
 * fullscreen player UI:
 *  - the toggle shows for every track that can have a video (YouTube id or
 *    searchable title/artist), and hides for metadata-less tracks
 *  - switching to Video mounts the muted video stage with the right id
 *    and swaps the square cover frame for a 16:9 video frame
 *  - the official music video id replaces the song id once resolved
 *  - catalog tracks (no YouTube id) resolve via findCatalogMatch on demand
 *  - switching back to Song unmounts it
 */

const mocks = vi.hoisted(() => ({
  usePlayerState: vi.fn(),
  VideoStage: vi.fn(() => <div data-testid="video-stage" />),
  findMusicVideoCandidates: vi.fn(async (): Promise<string[]> => []),
  findCatalogMatch: vi.fn(async (): Promise<unknown> => ({ status: "pending", reason: "no_catalog_candidates" })),
}));

vi.mock("../hooks/usePlayerState", () => ({
  usePlayerState: mocks.usePlayerState,
}));

vi.mock("@/features/covers", () => ({
  useCoverReady: vi.fn(() => true),
  CoverImage: () => <div data-testid="cover-image" />,
}));

vi.mock("@/languages", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("@solar-icons/react", () => ({
  MusicNote: () => <svg data-testid="icon-note" />,
}));

vi.mock("@mingcute/react", () => ({
  VideoLine: () => <svg data-testid="icon-video" />,
}));

vi.mock("./FullscreenVideoStage", () => ({
  getTrackVideoId: (track: { id: string } | null) =>
    track && track.id.startsWith("yt:") ? track.id.slice(3) : null,
  FullscreenVideoStage: mocks.VideoStage,
}));

vi.mock("../engine/musicVideoVersion", () => ({
  findMusicVideoCandidates: mocks.findMusicVideoCandidates,
}));

vi.mock("@/shared/youtube", () => ({
  toVideoId: (trackId: string) => {
    const videoId = trackId.replace(/^yt:/, "");
    return /^[a-zA-Z0-9_-]{11}$/.test(videoId) ? videoId : null;
  },
}));

vi.mock("@/shared/media/matching", () => ({
  findCatalogMatch: mocks.findCatalogMatch,
}));

vi.mock("./VolumePicker", () => ({ VolumePicker: () => <div /> }));
vi.mock("./FullscreenTrackInfo", () => ({
  FullscreenTrackInfo: () => <div />,
}));
vi.mock("./FullscreenTimeline", () => ({ FullscreenTimeline: () => <div /> }));
vi.mock("./FullscreenTransportControls", () => ({
  FullscreenTransportControls: () => <div />,
}));

import { PlayerUiElements } from "./PlayerUiElements";

function findButton(container: HTMLElement, label: string): HTMLButtonElement | null {
  const buttons = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  );
  return buttons.find((b) => b.getAttribute("aria-label") === label) ?? null;
}

describe("PlayerUiElements song/video rail", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.VideoStage.mockClear();
    mocks.findMusicVideoCandidates.mockClear();
    mocks.findMusicVideoCandidates.mockResolvedValue([]);
    mocks.findCatalogMatch.mockClear();
    mocks.findCatalogMatch.mockResolvedValue({ status: "pending", reason: "no_catalog_candidates" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("hides the toggle for metadata-less tracks", () => {
    mocks.usePlayerState.mockReturnValue({
      currentTrack: { id: "whatever", title: "", artists: "", coverUrl: "" },
    });
    act(() => {
      root.render(<PlayerUiElements />);
    });
    expect(findButton(container, "player.video")).toBeNull();
    expect(findButton(container, "player.song")).toBeNull();
    expect(container.querySelector('[data-testid="video-stage"]')).toBeNull();
  });

  it("shows the toggle for catalog tracks and deep-searches a video on demand", async () => {
    mocks.findCatalogMatch.mockResolvedValue({
      status: "approved",
      track: { id: "yt:CATVID00001", title: "Pepas" },
      score: 95,
    });
    mocks.usePlayerState.mockReturnValue({
      currentTrack: {
        id: "liner-abc-uuid",
        title: "Pepas",
        artists: "Farruko",
        coverUrl: "",
      },
    });
    act(() => {
      root.render(<PlayerUiElements />);
    });
    // optimistic toggle, nothing mounted yet
    expect(findButton(container, "player.video")).not.toBeNull();
    expect(container.querySelector('[data-testid="video-stage"]')).toBeNull();

    act(() => {
      findButton(container, "player.video")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    // resolving — no stage yet, "unavailable" not yet shown
    expect(container.querySelector('[data-testid="video-stage"]')).toBeNull();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.findCatalogMatch).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "liner-abc-uuid", title: "Pepas" }),
    );
    expect(mocks.VideoStage).toHaveBeenCalledWith(
      expect.objectContaining({ videoId: "CATVID00001" }),
      undefined,
    );
  });

  it("shows the unavailable note when the catalog match finds nothing", async () => {
    mocks.usePlayerState.mockReturnValue({
      currentTrack: {
        id: "liner-abc-uuid",
        title: "Pepas",
        artists: "Farruko",
        coverUrl: "",
      },
    });
    act(() => {
      root.render(<PlayerUiElements />);
    });
    act(() => {
      findButton(container, "player.video")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="video-stage"]')).toBeNull();
    expect(container.textContent).toContain("player.video_unavailable");
  });

  it("shows the rail for YouTube tracks and mounts the video stage on toggle", () => {
    mocks.usePlayerState.mockReturnValue({
      currentTrack: { id: "yt:dQw4w9WgXcQ", title: "Test", coverUrl: "" },
    });
    act(() => {
      root.render(<PlayerUiElements />);
    });
    const videoButton = findButton(container, "player.video");
    const songButton = findButton(container, "player.song");
    expect(videoButton).not.toBeNull();
    expect(songButton).not.toBeNull();
    expect(songButton?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-testid="video-stage"]')).toBeNull();

    act(() => {
      videoButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // video view swaps the square cover frame for a 16:9 video frame
    expect(container.querySelector(".aspect-video")).not.toBeNull();
    expect(container.querySelector(".aspect-square")).toBeNull();
    // React 19 invokes function components as (props, undefined)
    expect(mocks.VideoStage).toHaveBeenCalledWith(
      expect.objectContaining({ videoId: "dQw4w9WgXcQ" }),
      undefined,
    );
    expect(container.querySelector('[data-testid="video-stage"]')).not.toBeNull();
    expect(videoButton?.getAttribute("aria-pressed")).toBe("true");
  });

  it("swaps to the official music video id once resolved", async () => {
    mocks.findMusicVideoCandidates.mockResolvedValue(["OMVID12345"]);
    mocks.usePlayerState.mockReturnValue({
      currentTrack: {
        id: "yt:dQw4w9WgXcQ",
        title: "Pepas",
        artists: "Farruko",
        coverUrl: "",
      },
    });
    act(() => {
      root.render(<PlayerUiElements />);
    });
    const videoButton = findButton(container, "player.video");
    act(() => {
      videoButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // the own id shows instantly...
    expect(mocks.VideoStage).toHaveBeenCalledWith(
      expect.objectContaining({ videoId: "dQw4w9WgXcQ" }),
      undefined,
    );
    // ...then the stage rebuilds with the resolved official video
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.findMusicVideoCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ id: "yt:dQw4w9WgXcQ" }),
      "dQw4w9WgXcQ",
    );
    expect(mocks.VideoStage).toHaveBeenLastCalledWith(
      expect.objectContaining({ videoId: "OMVID12345" }),
      undefined,
    );
  });

  it("hands resolved alternates to the stage for embed-error fallback", async () => {
    mocks.findMusicVideoCandidates.mockResolvedValue(["OMVID12345", "MIRRORID01"]);
    mocks.usePlayerState.mockReturnValue({
      currentTrack: {
        id: "yt:dQw4w9WgXcQ",
        title: "Pepas",
        artists: "Farruko",
        coverUrl: "",
      },
    });
    act(() => {
      root.render(<PlayerUiElements />);
    });
    const videoButton = findButton(container, "player.video");
    act(() => {
      videoButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.VideoStage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        videoId: "OMVID12345",
        alternates: ["MIRRORID01"],
      }),
      undefined,
    );
  });

  it("switches back to the song view", () => {
    mocks.usePlayerState.mockReturnValue({
      currentTrack: { id: "yt:dQw4w9WgXcQ", title: "Test", coverUrl: "" },
    });
    act(() => {
      root.render(<PlayerUiElements />);
    });
    const videoButton = findButton(container, "player.video");
    act(() => {
      videoButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="video-stage"]')).not.toBeNull();

    const songButton = findButton(container, "player.song");
    act(() => {
      songButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="video-stage"]')).toBeNull();
    // back to the square cover frame
    expect(container.querySelector(".aspect-square")).not.toBeNull();
    expect(container.querySelector(".aspect-video")).toBeNull();
  });
});
