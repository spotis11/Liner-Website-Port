import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { usePlayerStore } from "../store/playerStore";
import { useModalStore } from "@/features/library/store/modalStore";
import type { Track } from "@/shared/types";
import { useAddCurrentTrackToPlaylist } from "./useAddCurrentTrackToPlaylist";

const track: Track = {
  id: "track-1",
  title: "All I Need",
  artists: "Radiohead",
  coverUrl: "https://example.com/cover.jpg",
  durationMs: 227_000,
  playCount: 0,
};

let canAdd = true;

function Probe() {
  const { canAddToPlaylist, openAddToPlaylist } = useAddCurrentTrackToPlaylist();
  canAdd = canAddToPlaylist;
  return (
    <button
      type="button"
      aria-label="add-to-playlist-probe"
      onClick={openAddToPlaylist}
    >
      add
    </button>
  );
}

function renderProbe(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<Probe />));
  return { container, root };
}

function clickAdd(container: HTMLDivElement) {
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label="add-to-playlist-probe"]',
  );
  if (!button) throw new Error("probe button not found");
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("useAddCurrentTrackToPlaylist", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    usePlayerStore.setState({ currentTrack: null });
    useModalStore.getState().closeAddToPlaylist();
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    usePlayerStore.setState({ currentTrack: null });
    useModalStore.getState().closeAddToPlaylist();
  });

  it("reports canAddToPlaylist=false and does nothing when no track is loaded", () => {
    ({ container, root } = renderProbe());
    expect(canAdd).toBe(false);
    clickAdd(container);
    const state = useModalStore.getState();
    expect(state.addToPlaylistOpen).toBe(false);
    expect(state.addToPlaylistTrack).toBeNull();
  });

  it("opens the Add-to-Playlist modal carrying the current track", () => {
    usePlayerStore.setState({ currentTrack: track });
    ({ container, root } = renderProbe());
    expect(canAdd).toBe(true);
    clickAdd(container);
    const state = useModalStore.getState();
    expect(state.addToPlaylistOpen).toBe(true);
    expect(state.addToPlaylistTrack).toEqual({
      id: "track-1",
      title: "All I Need",
      artists: "Radiohead",
      coverUrl: "https://example.com/cover.jpg",
      durationMs: 227_000,
    });
  });

  it("stays closed when the loaded track has no id (unresolvable track)", () => {
    usePlayerStore.setState({
      currentTrack: { ...track, id: "" },
    });
    ({ container, root } = renderProbe());
    expect(canAdd).toBe(false);
    clickAdd(container);
    expect(useModalStore.getState().addToPlaylistOpen).toBe(false);
  });

  it("tracks the live player state: new current track updates the payload", () => {
    ({ container, root } = renderProbe());
    expect(canAdd).toBe(false);

    act(() => {
      usePlayerStore.setState({ currentTrack: track });
    });
    expect(canAdd).toBe(true);
    clickAdd(container);
    expect(useModalStore.getState().addToPlaylistTrack?.id).toBe("track-1");
    useModalStore.getState().closeAddToPlaylist();

    act(() => {
      usePlayerStore.setState({
        currentTrack: { ...track, id: "track-2", title: "Weird Fishes" },
      });
    });
    clickAdd(container);
    const state = useModalStore.getState();
    expect(state.addToPlaylistOpen).toBe(true);
    expect(state.addToPlaylistTrack?.id).toBe("track-2");
    expect(state.addToPlaylistTrack?.title).toBe("Weird Fishes");
  });
});
