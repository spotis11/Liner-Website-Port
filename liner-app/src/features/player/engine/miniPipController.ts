// Spotify-style miniplayer that follows the user across browser tabs.
//
// Uses the Document Picture-in-Picture API (Chromium) to open a small
// always-on-top window with compact transport controls. The PiP window shares
// this page's JS context, so the existing zustand stores + playerEngine drive
// it directly — no cross-window syncing needed.
//
// Detection paths ("when I go to the other tab, it will detect it"):
//  1. `enterpictureinpicture` media session action handler — Chrome fires it
//     from its own media controls, and (Chrome 133+, when "auto picture-in-
//     picture" is enabled) automatically when the user switches away from a
//     tab that is playing media.
//  2. A best-effort `visibilitychange` hook: when the tab is hidden while a
//     track is playing we attempt to open the window; browsers that require a
//     user gesture simply reject the promise and we stay silent. Coming BACK
//     to the Liner tab closes the miniplayer again, immediately.
//  3. A manual miniplayer button in the player bar (user gesture — always
//     works where the API exists).
//
// The whole feature is gated by the `miniPlayerEnabled` setting in
// Settings -> Playback: with it off nothing opens automatically, the manual
// button disappears, and an already-open window is closed at once.

import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { usePlayerStore } from "../store/playerStore";

interface DocumentPictureInPicture {
  requestWindow: (options?: {
    width?: number;
    height?: number;
  }) => Promise<Window>;
  window: Window | null;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

const MINI_PIP_WIDTH = 384;
const MINI_PIP_HEIGHT = 152;

let pipWindow: Window | null = null;
let pipRoot: Root | null = null;

export function isMiniPipSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "documentPictureInPicture" in window &&
    window.documentPictureInPicture != null &&
    typeof window.documentPictureInPicture.requestWindow === "function"
  );
}

export function isMiniPipOpen(): boolean {
  return pipWindow !== null && !pipWindow.closed;
}

export function closeMiniPip(): void {
  try {
    if (pipWindow && !pipWindow.closed) pipWindow.close();
  } catch {
    // the window may already be gone
  }
  teardownPipWindow();
}

function teardownPipWindow(): void {
  try {
    pipRoot?.unmount();
  } catch {
    // root may already be unmounted with its window
  }
  pipRoot = null;
  pipWindow = null;
}

function copyStyles(sourceDoc: Document, targetDoc: Document): void {
  for (const sheet of Array.from(sourceDoc.styleSheets)) {
    try {
      const owner = sheet.ownerNode;
      if (owner instanceof HTMLLinkElement) {
        const link = sourceDoc.createElement("link");
        link.rel = "stylesheet";
        link.href = owner.href;
        targetDoc.head.appendChild(link);
      } else if (owner instanceof HTMLStyleElement) {
        const style = sourceDoc.createElement("style");
        let css = "";
        try {
          css = Array.from(sheet.cssRules)
            .map((rule) => rule.cssText)
            .join("\n");
        } catch {
          css = owner.textContent ?? "";
        }
        style.textContent = css;
        targetDoc.head.appendChild(style);
      }
    } catch {
      // cross-origin or detachable sheets we cannot clone — skip them
    }
  }
}

export async function openMiniPip(): Promise<Window | null> {
  if (!isMiniPipSupported()) return null;
  // Settings -> Playback toggle: when the miniplayer is disabled nothing may
  // open it (the manual button is hidden too — this is the belt to its braces).
  if (!usePlayerStore.getState().miniPlayerEnabled) return null;

  if (pipWindow && !pipWindow.closed) {
    return pipWindow;
  }

  const pip = await window.documentPictureInPicture!.requestWindow({
    width: MINI_PIP_WIDTH,
    height: MINI_PIP_HEIGHT,
  });

  pipWindow = pip;

  // Same-origin window: clone the app's styling so the mini player matches.
  copyStyles(document, pip.document);
  // The mini player always renders on the dark theme, like the fullscreen
  // player overlay.
  pip.document.documentElement.setAttribute("data-theme", "dark");
  pip.document.documentElement.classList.add("dark");
  pip.document.body.classList.add("dark");
  pip.document.body.style.margin = "0";
  pip.document.body.style.overflow = "hidden";
  pip.document.title = "Liner — Miniplayer";

  pip.addEventListener(
    "pagehide",
    () => {
      teardownPipWindow();
    },
    { once: true },
  );

  const host = pip.document.createElement("div");
  host.id = "liner-mini-pip-root";
  pip.document.body.appendChild(host);

  const { default: MiniPipPlayer } = await import("../ui/MiniPipPlayer");
  pipRoot = createRoot(host);
  pipRoot.render(createElement(MiniPipPlayer, { pipWindow: pip }));

  return pip;
}

let detachFns: Array<() => void> = [];

/**
 * Registers the automatic mini-player behaviors. Safe to call multiple times
 * (previous listeners are detached first). Returns a detach function.
 */
export function attachMiniPipAutoBehavior(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  detachMiniPipAutoBehavior();

  // 1) Chrome media controls / automatic PiP while media plays (Chrome 133+).
  try {
    if ("mediaSession" in navigator) {
      // "enterpictureinpicture" is newer than the TS DOM lib's action union.
      const enterPipAction = "enterpictureinpicture" as MediaSessionAction;
      navigator.mediaSession.setActionHandler(enterPipAction, () => {
        if (!usePlayerStore.getState().miniPlayerEnabled) return;
        void openMiniPip().catch(() => {});
      });
      detachFns.push(() => {
        try {
          navigator.mediaSession.setActionHandler(enterPipAction, null);
        } catch {
          // ignore
        }
      });
    }
  } catch {
    // enterpictureinpicture is not supported in this engine — fine
  }

  // 2) Best-effort: opening when the tab becomes hidden. Requires user
  //    activation on some Chrome versions; the rejection is silent.
  //    Coming back to the Liner tab ("visible") tears the miniplayer down
  //    again — synchronously, so it disappears without any delay.
  const onVisibilityChange = () => {
    try {
      if (document.visibilityState === "visible") {
        // Back on the Liner tab → the miniplayer must vanish immediately.
        if (pipWindow && !pipWindow.closed) closeMiniPip();
        return;
      }
      if (pipWindow && !pipWindow.closed) return;
      if (!usePlayerStore.getState().miniPlayerEnabled) return;
      const state = usePlayerStore.getState();
      const isActive =
        state.currentTrack !== null &&
        (state.status === "playing" || state.status === "loading");
      if (!isActive) return;
      void openMiniPip().catch(() => {});
    } catch {
      // never let detection break the page
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  detachFns.push(() =>
    document.removeEventListener("visibilitychange", onVisibilityChange),
  );

  // 3) Flipping the Settings toggle off closes an already-open miniplayer
  //    at the same moment.
  const unsubscribe = usePlayerStore.subscribe((state, prev) => {
    try {
      if (prev.miniPlayerEnabled && !state.miniPlayerEnabled) {
        closeMiniPip();
      }
    } catch {
      // never let the toggle break the page
    }
  });
  detachFns.push(unsubscribe);

  return detachMiniPipAutoBehavior;
}

export function detachMiniPipAutoBehavior(): void {
  for (const fn of detachFns) {
    try {
      fn();
    } catch {
      // ignore
    }
  }
  detachFns = [];
}
