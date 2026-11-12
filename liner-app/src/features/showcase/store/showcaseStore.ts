import { create } from "zustand";
import type { ShowcaseStatus } from "../lib/showcaseApi";

/**
 * Website Showcase ("randomize website") state. When `active` is true the
 * ShowcaseSync controller scrambles the website name (browser tab title,
 * login wordmark) with random letters every few milliseconds, covers the
 * address bar down to the bare domain, and text nodes hooked via
 * useShowcaseName() follow along.
 *
 * Unlike the maintenance wall this state is NOT mirrored to localStorage:
 * showcase is purely cosmetic, so a fresh page load simply starts "off"
 * and flips on the moment the first probe answers (well under a second).
 */
export type ShowcaseState = {
  active: boolean;
  setActive: (status: ShowcaseStatus) => void;
  clearActive: () => void;
};

export function createShowcaseStore() {
  return create<ShowcaseState>((set) => ({
    active: false,
    setActive: () => set({ active: true }),
    clearActive: () => set({ active: false }),
  }));
}

export const useShowcaseStore = createShowcaseStore();

/**
 * What the sync controller does with a status probe answer. Kept pure for
 * tests:
 *  - "start" → the server confirms showcase mode (start/keep scrambling);
 *  - "stop"  → the server authoritatively answered "not showcasing" —
 *              restore the real name.
 */
export type ShowcaseDecision = { action: "start" } | { action: "stop" };

export function decideShowcaseAction(status: ShowcaseStatus): ShowcaseDecision {
  return status.enabled ? { action: "start" } : { action: "stop" };
}

/**
 * Apply a status answer to the live store. One entry point for every
 * source of truth — the boot/15s probe loop AND the owner's Moderation
 * toggle (which feeds the POST response straight in, so the owner's own
 * tab starts covering the moment the switch flips, with no refresh).
 */
export function applyShowcaseStatus(status: ShowcaseStatus): void {
  if (decideShowcaseAction(status).action === "start") {
    useShowcaseStore.getState().setActive(status);
  } else {
    useShowcaseStore.getState().clearActive();
  }
}
