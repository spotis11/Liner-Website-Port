import { create } from "zustand";
import {
  fetchCurrentAnnouncement,
  type Announcement,
} from "../lib/announcementsApi";

/**
 * Global announcement polling store.
 *
 * The admin is told "the message will send globally within 10 seconds", so
 * every client polls the probe endpoint every 5 seconds (worst case the
 * popup lands ~5s after the broadcast, well inside the promise). Each
 * announcement stays visible for 60 seconds from its createdAt ("this
 * message will be gone within 1 minute"), and a visitor who dismisses it
 * with the Okay button never sees that same announcement again.
 */

const POLL_INTERVAL_MS = 5_000;
const LIVE_WINDOW_MS = 60_000;
const DISMISSED_STORAGE_KEY = "liner.announcement.dismissedId";

type AnnouncementState = {
  /** The announcement currently showing in the popup (null = quiet). */
  active: Announcement | null;
  start: () => void;
  stop: () => void;
  dismiss: () => void;
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let inFlight = false;

function getDismissedId(): string | null {
  try {
    return localStorage.getItem(DISMISSED_STORAGE_KEY);
  } catch {
    return null;
  }
}

function announcementAgeMs(a: Announcement): number {
  // Age counts from showAt (the moment the announcement goes live) so the
  // "gone within 1 minute" window starts when the popup actually appears.
  // Older servers without showAt fall back to createdAt.
  const shown = Date.parse(a.showAt ?? "") || Date.parse(a.createdAt);
  // treat malformed timestamps as already expired
  if (Number.isNaN(shown)) return LIVE_WINDOW_MS;
  return Date.now() - shown;
}

function isExpired(a: Announcement): boolean {
  return announcementAgeMs(a) >= LIVE_WINDOW_MS;
}

function msUntilExpiry(a: Announcement): number {
  return Math.max(0, LIVE_WINDOW_MS - announcementAgeMs(a));
}

function clearTimers(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function onWake(): void {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  void poll();
}

async function poll(): Promise<void> {
  if (!running || inFlight) return;
  inFlight = true;
  try {
    const announcement = await fetchCurrentAnnouncement();
    if (!running) return;

    const showable =
      announcement &&
      !isExpired(announcement) &&
      // server already withholds pre-delay announcements; double-guard anyway
      // so a future showAt can never flash the popup early
      announcementAgeMs(announcement) >= 0 &&
      getDismissedId() !== announcement.id;

    if (!showable) {
      if (useAnnouncementStore.getState().active) {
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }
        useAnnouncementStore.setState({ active: null });
      }
      return;
    }

    // already showing this exact announcement — keep the original hide timer
    if (useAnnouncementStore.getState().active?.id === announcement.id) return;

    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    useAnnouncementStore.setState({ active: announcement });

    const remaining = msUntilExpiry(announcement);
    if (remaining <= 0) {
      useAnnouncementStore.setState({ active: null });
      return;
    }
    hideTimer = setTimeout(
      (id) => {
        hideTimer = null;
        if (useAnnouncementStore.getState().active?.id === id) {
          useAnnouncementStore.setState({ active: null });
        }
      },
      remaining + 250,
      announcement.id,
    );
  } catch {
    // offline or probe hiccup — retry on the next tick
  } finally {
    inFlight = false;
  }
}

export const useAnnouncementStore = create<AnnouncementState>((set, get) => ({
  active: null,

  start: () => {
    if (running || typeof window === "undefined") return;
    running = true;
    void poll();
    pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    // catch announcements that land while the tab was in the background
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
  },

  stop: () => {
    running = false;
    clearTimers();
    document.removeEventListener("visibilitychange", onWake);
    window.removeEventListener("online", onWake);
  },

  dismiss: () => {
    const current = get().active;
    if (current) {
      try {
        localStorage.setItem(DISMISSED_STORAGE_KEY, current.id);
      } catch {
        // storage unavailable — the popup just may come back until expiry
      }
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    set({ active: null });
  },
}));
