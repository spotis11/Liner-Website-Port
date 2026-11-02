import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Focused tests for the fullscreen player's Lyrics toggle button:
 *  - pill renders with the right pressed state
 *  - clicking collapses/expands the lyrics pane (width choreography)
 *  - the preference persists across remounts via localStorage
 *
 * framer-motion is stubbed to apply `animate` values as inline styles
 * synchronously so the width choreography is assertable without rAF.
 * The actual tweening (duration/ease) is framer-motion's own job.
 */

const mocks = vi.hoisted(() => ({
  usePlayerState: vi.fn(),
  useLyricsStore: Object.assign(vi.fn(), { getState: vi.fn() }),
  onClose: vi.fn(),
}));

vi.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        (props: Record<string, unknown>) => {
          const { animate, initial, transition, exit, ...rest } = props;
          void initial;
          void transition;
          void exit;
          return React.createElement(tag, {
            ...rest,
            style: { ...(props.style as object), ...(animate as object) },
          });
        },
    },
  ),
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../hooks/usePlayerState", () => ({
  usePlayerState: mocks.usePlayerState,
}));

vi.mock("../engine/playerEngine", () => ({
  playerEngine: { getSnapshot: vi.fn(() => ({ status: "playing" })) },
}));

vi.mock("@/features/lyrics", () => ({
  useLyricsStore: mocks.useLyricsStore,
  LyricsProviderIsland: () => <div data-testid="provider-island" />,
  braccatoThemeCss: "",
}));

vi.mock("./PlayerUiElements", () => ({
  PlayerUiElements: () => <div data-testid="player-ui" />,
}));

vi.mock("@/features/covers", () => ({
  preloadCoverArt: vi.fn(async () => {}),
  useCoverSrc: vi.fn(() => ""),
  useCoverElement: vi.fn(() => undefined),
  getCoverElement: vi.fn(() => undefined),
  useCoverReady: vi.fn(() => true),
  CoverImage: () => <div data-testid="cover-image" />,
}));

vi.mock("./KawarpWrapper", () => ({
  default: () => <div data-testid="kawarp" />,
}));

vi.mock("@/languages", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { FullscreenPlayer } from "./FullscreenPlayer";

const STORE_STATE = {
  braccatoLyrics: [],
  lyricsLoading: false,
  lyricsError: null as string | null,
  plainLyrics: "",
  availableProviders: [] as unknown[],
  currentLyricsTrackId: null as string | null,
};

function renderFullscreen(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<FullscreenPlayer onClose={mocks.onClose} />);
  });
  return { container, root };
}

function findRightPane(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(".min-h-0.overflow-hidden");
}

function findLeftPane(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(".items-center.justify-center");
}

function findLyricsPill(container: HTMLElement): HTMLButtonElement | null {
  const buttons = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  );
  return buttons.find((b) => b.textContent?.trim() === "player.lyrics") ?? null;
}

describe("FullscreenPlayer lyrics toggle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    mocks.usePlayerState.mockReturnValue({
      currentTrack: { id: "t1", title: "Test", artist: "A", coverUrl: "" },
      queue: [],
      currentIndex: 0,
      status: "playing",
      positionMs: 0,
    });
    mocks.useLyricsStore.mockReturnValue(STORE_STATE);
    mocks.useLyricsStore.getState.mockReturnValue({
      syncedLines: [],
      setActiveLineIndex: vi.fn(),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("renders the Lyrics pill pressed (pane visible by default)", () => {
    ({ container, root } = renderFullscreen());
    const pill = findLyricsPill(container);
    expect(pill).not.toBeNull();
    expect(pill!.getAttribute("aria-pressed")).toBe("true");
    // both panes at half width
    expect(findLeftPane(container)!.style.width).toBe("50%");
    expect(findRightPane(container)!.style.width).toBe("50%");
  });

  it("collapses the lyrics pane and centers the player when toggled", () => {
    ({ container, root } = renderFullscreen());
    const pill = findLyricsPill(container)!;
    act(() => pill.click());
    expect(pill.getAttribute("aria-pressed")).toBe("false");
    expect(findLeftPane(container)!.style.width).toBe("100%");
    const right = findRightPane(container)!;
    expect(right.style.width).toBe("0%");
    expect(right.style.opacity).toBe("0");
    expect(localStorage.getItem("liner.fullscreen.lyricsVisible")).toBe("0");
  });

  it("expands the pane again on second toggle", () => {
    ({ container, root } = renderFullscreen());
    const pill = findLyricsPill(container)!;
    act(() => pill.click());
    act(() => pill.click());
    expect(pill.getAttribute("aria-pressed")).toBe("true");
    expect(findLeftPane(container)!.style.width).toBe("50%");
    expect(findRightPane(container)!.style.width).toBe("50%");
    expect(localStorage.getItem("liner.fullscreen.lyricsVisible")).toBe("1");
  });

  it("restores the hidden-lyrics preference across remounts", () => {
    localStorage.setItem("liner.fullscreen.lyricsVisible", "0");
    ({ container, root } = renderFullscreen());
    const pill = findLyricsPill(container)!;
    expect(pill.getAttribute("aria-pressed")).toBe("false");
    expect(findRightPane(container)!.style.width).toBe("0%");
    expect(findLeftPane(container)!.style.width).toBe("100%");
  });
});
