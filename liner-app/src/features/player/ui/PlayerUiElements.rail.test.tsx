import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Focused tests for the YouTube-Music-style Song/Video rail in the
 * fullscreen player UI:
 *  - the rail only appears when the current track has a video
 *  - switching to Video mounts the muted video stage with the right id
 *  - switching back to Song unmounts it
 */

const mocks = vi.hoisted(() => ({
  usePlayerState: vi.fn(),
  VideoStage: vi.fn(() => <div data-testid="video-stage" />),
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
    // React 19 invokes function components as (props, undefined)
    expect(mocks.VideoStage).toHaveBeenCalledWith(
      expect.objectContaining({ videoId: "dQw4w9WgXcQ" }),
      undefined,
    );
    expect(container.querySelector('[data-testid="video-stage"]')).not.toBeNull();
    expect(videoButton?.getAttribute("aria-pressed")).toBe("true");
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
  });
});
