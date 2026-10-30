import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Focused tests for the YouTube-Music-style Song/Video toggle in the
 * fullscreen player UI:
 *  - the toggle only appears when the current track has a video
 *  - switching to Video mounts the muted video stage with the right id
 *    and swaps the square cover frame for a 16:9 video frame
 *  - the official music video id replaces the song id once resolved
 *  - switching back to Song unmounts it
 */

const mocks = vi.hoisted(() => ({
  usePlayerState: vi.fn(),
  VideoStage: vi.fn(() => <div data-testid="video-stage" />),
  findMusicVideoVersion: vi.fn(async (): Promise<string | null> => null),
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
  findMusicVideoVersion: mocks.findMusicVideoVersion,
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
    mocks.findMusicVideoVersion.mockClear();
    mocks.findMusicVideoVersion.mockResolvedValue(null);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("hides the rail for tracks without a video", () => {
    mocks.usePlayerState.mockReturnValue({
      currentTrack: { id: "sc:12345", title: "Test", coverUrl: "" },
    });
    act(() => {
      root.render(<PlayerUiElements />);
    });
    expect(findButton(container, "player.video")).toBeNull();
    expect(findButton(container, "player.song")).toBeNull();
    expect(container.querySelector('[data-testid="video-stage"]')).toBeNull();
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
    mocks.findMusicVideoVersion.mockResolvedValue("OMVID12345");
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
    expect(mocks.findMusicVideoVersion).toHaveBeenCalledWith(
      expect.objectContaining({ id: "yt:dQw4w9WgXcQ" }),
      "dQw4w9WgXcQ",
    );
    expect(mocks.VideoStage).toHaveBeenLastCalledWith(
      expect.objectContaining({ videoId: "OMVID12345" }),
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
