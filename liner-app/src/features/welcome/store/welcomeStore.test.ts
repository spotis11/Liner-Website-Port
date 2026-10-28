import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createWelcomeStore,
  emptyDraft,
  MAX_ARTIST_PICKS,
  ONBOARDING_FINALE_STEP,
  ONBOARDING_STEP_COUNT,
  ONBOARDED_STORAGE_KEY,
  WELCOME_STORAGE_KEY,
} from "./welcomeStore";
import type { PublicUser } from "@/shared/api";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

function user(patch: Partial<PublicUser> = {}): PublicUser {
  return {
    id: "u1",
    username: "newbie",
    displayName: "Newbie",
    ...patch,
  };
}

let storage: Storage;

beforeEach(() => {
  storage = memoryStorage();
});

describe("welcomeStore flows", () => {
  it("sign-in shows the greeting flow and is NOT persisted", () => {
    const store = createWelcomeStore(storage);
    store.getState().notifyLogin(user({ username: "jay", displayName: "Jay" }));

    const active = store.getState().active;
    expect(active?.kind).toBe("signin");
    expect(active?.displayName).toBe("Jay");

    // refresh simulation: a brand-new store sees nothing
    const revived = createWelcomeStore(storage);
    expect(revived.getState().active).toBeNull();
    expect(storage.getItem(WELCOME_STORAGE_KEY)).toBeNull();
  });

  it("sign-up starts the wizard at step 1 and persists it", () => {
    const store = createWelcomeStore(storage);
    store.getState().notifyRegister(user());

    const active = store.getState().active;
    expect(active?.kind).toBe("signup");
    expect(active?.step).toBe(1);
    expect(active?.draft).toEqual(emptyDraft());

    const persisted = JSON.parse(
      storage.getItem(WELCOME_STORAGE_KEY) ?? "null",
    );
    expect(persisted.signup.username).toBe("newbie");
    expect(persisted.signup.step).toBe(1);
  });

  it("next/back walk the wizard; step 3 next lands on the finale", () => {
    const store = createWelcomeStore(storage);
    store.getState().notifyRegister(user());
    store.getState().next();
    expect(store.getState().active?.step).toBe(2);
    store.getState().next();
    expect(store.getState().active?.step).toBe(3);
    store.getState().next();
    expect(store.getState().active?.step).toBe(ONBOARDING_FINALE_STEP);
    store.getState().back();
    expect(store.getState().active?.step).toBe(ONBOARDING_STEP_COUNT);
  });

  it("step-1 back closes the flow and records onboarding", () => {
    const store = createWelcomeStore(storage);
    store.getState().notifyRegister(user());
    store.getState().back();

    expect(store.getState().active).toBeNull();
    const onboarded = JSON.parse(
      storage.getItem(ONBOARDED_STORAGE_KEY) ?? "[]",
    );
    expect(onboarded).toContain("newbie");
    expect(JSON.parse(storage.getItem(WELCOME_STORAGE_KEY) ?? "null").signup)
      .toBeNull();
  });

  it("complete() from the finale marks onboarding and clears state", () => {
    const store = createWelcomeStore(storage);
    store.getState().notifyRegister(user());
    store.getState().next();
    store.getState().next();
    store.getState().next();
    store.getState().complete();

    expect(store.getState().active).toBeNull();
    const onboarded = JSON.parse(
      storage.getItem(ONBOARDED_STORAGE_KEY) ?? "[]",
    );
    expect(onboarded).toContain("newbie");
  });

  it("never re-onboards an account that already completed the wizard", () => {
    const store = createWelcomeStore(storage);
    store.getState().notifyRegister(user());
    store.getState().complete();
    store.getState().notifyRegister(user());
    expect(store.getState().active).toBeNull();
  });

  it("syncSession resumes a persisted flow for the same user only", () => {
    const store = createWelcomeStore(storage);
    store.getState().notifyRegister(user());
    store.getState().next();
    // simulate refresh: new store hydrates persistedSignup, no active flow
    const revived = createWelcomeStore(storage);
    expect(revived.getState().active).toBeNull();
    revived.getState().syncSession("newbie");
    expect(revived.getState().active?.kind).toBe("signup");
    expect(revived.getState().active?.step).toBe(2);

    // a different account must NOT adopt it — the stale record is wiped
    const other = createWelcomeStore(storage);
    other.getState().syncSession("someone-else");
    expect(other.getState().active).toBeNull();
    expect(other.getState().persistedSignup).toBeNull();
  });

  it("draft helpers: avatar set + artist picks capped at 3", () => {
    const store = createWelcomeStore(storage);
    store.getState().notifyRegister(user());

    store.getState().setDraftAvatar("data:image/png;base64,abc");
    expect(store.getState().active?.draft.avatarUrl).toBe(
      "data:image/png;base64,abc",
    );

    for (const id of ["a", "b", "c"]) store.getState().toggleArtist(id);
    expect(store.getState().active?.draft.artistIds).toEqual(["a", "b", "c"]);
    // cap: a 4th pick is ignored; re-click removes
    store.getState().toggleArtist("d");
    expect(store.getState().active?.draft.artistIds).toHaveLength(
      MAX_ARTIST_PICKS,
    );
    store.getState().toggleArtist("b");
    expect(store.getState().active?.draft.artistIds).toEqual(["a", "c"]);
  });

  it("tolerates corrupt persistence and storage outages", () => {
    storage.setItem(WELCOME_STORAGE_KEY, "{not json");
    storage.setItem(ONBOARDED_STORAGE_KEY, "nope");
    expect(() => createWelcomeStore(storage)).not.toThrow();
    const store = createWelcomeStore(storage);
    expect(store.getState().persistedSignup).toBeNull();

    const throwing: Storage = {
      ...storage,
      setItem: () => {
        throw new Error("quota");
      },
      getItem: () => {
        throw new Error("blocked");
      },
    };
    const hard = createWelcomeStore(throwing);
    hard.getState().notifyRegister(user());
    expect(hard.getState().active?.kind).toBe("signup");
  });
});
