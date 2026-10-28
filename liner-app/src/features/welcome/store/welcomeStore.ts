// Welcome flow store: post-sign-in greeting vs. post-sign-up onboarding.
//
// The two flows are deliberately different (product request):
//  - "signin"  → a single "Welcome back!" greeting screen, shown on every
//                explicit login. Purely in-memory: a refresh never re-shows it.
//  - "signup"  → a 3-step onboarding wizard (profile picture → 3 artists →
//                theme) plus a finale. PERSISTED so a refresh mid-onboarding
//                resumes where the user left off (same philosophy as the ban
//                wall: synchronous hydration, tolerant of corrupt records and
//                storage outages).
//
// Completed onboarding is tracked per username so a brand-new account is
// never re-prompted after finishing (or skipping) the wizard.

import { create } from "zustand";
import type { PublicUser } from "@/shared/api";

export type WelcomeKind = "signin" | "signup";

export interface WelcomeDraft {
  /** Data URL of the picked profile picture (not yet saved to the account). */
  avatarUrl: string | null;
  /** Artist ids picked in step 2 (max 3). */
  artistIds: string[];
  /** Set when the artist grid failed to load — unlocks Next without picks. */
  artistsEscape: boolean;
}

export interface WelcomeFlow {
  kind: WelcomeKind;
  username: string;
  displayName: string;
  /** 1..3 wizard steps; 4 = signup finale. Ignored for signin. */
  step: number;
  draft: WelcomeDraft;
}

export const WELCOME_STORAGE_KEY = "liner_web_welcome_v1";
export const ONBOARDED_STORAGE_KEY = "liner_web_onboarded_v1";
export const ONBOARDING_STEP_COUNT = 3;
export const ONBOARDING_FINALE_STEP = 4;
export const MAX_ARTIST_PICKS = 3;

export function emptyDraft(): WelcomeDraft {
  return { avatarUrl: null, artistIds: [], artistsEscape: false };
}

interface PersistedSignup {
  username: string;
  displayName: string;
  step: number;
  draft: WelcomeDraft;
}

interface PersistedWelcome {
  signup: PersistedSignup | null;
}

const PERSISTED_SIGNUP_STEPS = new Set([1, 2, 3, ONBOARDING_FINALE_STEP]);

function readPersistedWelcome(storage: Storage | null): PersistedWelcome {
  const fallback: PersistedWelcome = { signup: null };
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(WELCOME_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedWelcome> | null;
    if (!parsed || typeof parsed !== "object") return fallback;
    const signup = parsed.signup;
    if (
      !signup ||
      typeof signup !== "object" ||
      typeof signup.username !== "string" ||
      !signup.username ||
      !PERSISTED_SIGNUP_STEPS.has(signup.step as number)
    ) {
      return fallback;
    }
    const draft = signup.draft;
    const safeDraft: WelcomeDraft = {
      avatarUrl:
        typeof draft?.avatarUrl === "string" && draft.avatarUrl
          ? draft.avatarUrl
          : null,
      artistIds: Array.isArray(draft?.artistIds)
        ? draft.artistIds
            .filter((id): id is string => typeof id === "string" && !!id)
            .slice(0, MAX_ARTIST_PICKS)
        : [],
      artistsEscape: draft?.artistsEscape === true,
    };
    return {
      signup: {
        username: signup.username,
        displayName:
          typeof signup.displayName === "string" && signup.displayName
            ? signup.displayName
            : signup.username,
        step: signup.step as number,
        draft: safeDraft,
      },
    };
  } catch {
    return fallback;
  }
}

function writePersistedWelcome(
  storage: Storage | null,
  value: PersistedWelcome,
): void {
  if (!storage) return;
  try {
    storage.setItem(WELCOME_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage outages (private mode / quota) must never crash the app.
  }
}

function readOnboarded(storage: Storage | null): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(ONBOARDED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && !!v);
  } catch {
    return [];
  }
}

function writeOnboarded(storage: Storage | null, list: string[]): void {
  if (!storage) return;
  try {
    // Cap the list so it can never grow unbounded.
    storage.setItem(
      ONBOARDED_STORAGE_KEY,
      JSON.stringify(list.slice(-300)),
    );
  } catch {
    // ignore
  }
}

function defaultStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface WelcomeState {
  active: WelcomeFlow | null;
  /** Persisted signup flow found at boot, waiting for a matching session. */
  persistedSignup: PersistedSignup | null;
  notifyLogin: (user: PublicUser) => void;
  notifyRegister: (user: PublicUser) => void;
  /** Re-attach (or drop) a persisted signup flow once the session is known. */
  syncSession: (username: string | null | undefined) => void;
  next: () => void;
  back: () => void;
  /** Leave the flow without finishing — marks onboarding done for the user. */
  close: () => void;
  /** Finish the flow from the finale — same bookkeeping as close(). */
  complete: () => void;
  setDraftAvatar: (dataUrl: string | null) => void;
  toggleArtist: (artistId: string) => void;
  setArtistsEscape: (value: boolean) => void;
}

function flowToPersisted(flow: WelcomeFlow): PersistedSignup | null {
  if (flow.kind !== "signup") return null;
  return {
    username: flow.username,
    displayName: flow.displayName,
    step: flow.step,
    draft: flow.draft,
  };
}

export function createWelcomeStore(storage: Storage | null = defaultStorage()) {
  const boot = readPersistedWelcome(storage);

    return create<WelcomeState>()((set, get) => {
    const finishOnboarding = () => {
      const active = get().active;
      if (active?.username) {
        const onboarded = readOnboarded(storage);
        if (!onboarded.includes(active.username)) {
          onboarded.push(active.username);
          writeOnboarded(storage, onboarded);
        }
      }
      writePersistedWelcome(storage, { signup: null });
      set({ active: null, persistedSignup: null });
    };

    const persistActive = (active: WelcomeFlow) => {
      const persisted = flowToPersisted(active);
      writePersistedWelcome(storage, { signup: persisted });
      set({ active, persistedSignup: persisted });
    };

      return {
        active: null,
        persistedSignup: boot.signup,
    notifyLogin: (user) => {
      const displayName =
        user.displayName || user.username || "there";
      set({
        active: {
          kind: "signin",
          username: user.username ?? "",
          displayName,
          step: 1,
          draft: emptyDraft(),
        },
      });
    },
    notifyRegister: (user) => {
      const username = user.username ?? "";
      if (!username) return;
      // Defensive: never re-onboard an account that already finished.
      if (readOnboarded(storage).includes(username)) return;
      persistActive({
        kind: "signup",
        username,
        displayName: user.displayName || username,
        step: 1,
        draft: emptyDraft(),
      });
    },
    syncSession: (username) => {
      const state = get();
      if (state.active) return;
      const persisted = state.persistedSignup;
      if (!persisted) return;
      if (username && persisted.username === username) {
        set({
          active: {
            kind: "signup",
            username: persisted.username,
            displayName: persisted.displayName,
            step: persisted.step,
            draft: persisted.draft,
          },
        });
      } else {
        // Session belongs to someone else (or nobody) — drop stale record.
        writePersistedWelcome(storage, { signup: null });
        set({ persistedSignup: null });
      }
    },
    next: () => {
      const active = get().active;
      if (!active) return;
      const step = Math.min(active.step + 1, ONBOARDING_FINALE_STEP);
      persistActive({ ...active, step });
    },
    back: () => {
      const active = get().active;
      if (!active) return;
      if (active.step <= 1) {
        // Step 1 "Go back" leaves the wizard (can be finished later).
        finishOnboarding();
        return;
      }
      persistActive({ ...active, step: active.step - 1 });
    },
    close: () => finishOnboarding(),
    complete: () => finishOnboarding(),
    setDraftAvatar: (dataUrl) => {
      const active = get().active;
      if (!active) return;
      persistActive({
        ...active,
        draft: { ...active.draft, avatarUrl: dataUrl },
      });
    },
    toggleArtist: (artistId) => {
      const active = get().active;
      if (!active) return;
      const picked = active.draft.artistIds;
      let artistIds: string[];
      if (picked.includes(artistId)) {
        artistIds = picked.filter((id) => id !== artistId);
      } else {
        if (picked.length >= MAX_ARTIST_PICKS) return; // cap at 3
        artistIds = [...picked, artistId];
      }
      persistActive({
        ...active,
        draft: { ...active.draft, artistIds },
      });
    },
    setArtistsEscape: (value) => {
      const active = get().active;
      if (!active) return;
      persistActive({
        ...active,
        draft: { ...active.draft, artistsEscape: value },
      });
    },
      };
  });
}

/** Default singleton store (reads any persisted signup flow at import time). */
export const useWelcomeStore = createWelcomeStore();
