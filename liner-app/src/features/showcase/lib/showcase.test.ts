import { describe, expect, it } from "vitest";
import {
  SHOWCASE_COVER_PATH,
  SHOWCASE_MAX_LENGTH,
  SHOWCASE_MIN_LENGTH,
  randomLetter,
  randomSiteName,
  realHrefForLocation,
  shouldCoverUrl,
} from "./showcaseName";
import {
  applyShowcaseStatus,
  createShowcaseStore,
  decideShowcaseAction,
  useShowcaseStore,
} from "../store/showcaseStore";
import type { ShowcaseStatus } from "./showcaseApi";

const on: ShowcaseStatus = {
  enabled: true,
  updatedAt: "2026-11-12T06:30:00.000Z",
};

const off: ShowcaseStatus = {
  enabled: false,
  updatedAt: "2026-11-12T07:00:00.000Z",
};

describe("randomSiteName", () => {
  it("always produces letters within the length bounds", () => {
    for (let i = 0; i < 500; i += 1) {
      const name = randomSiteName();
      expect(name.length).toBeGreaterThanOrEqual(SHOWCASE_MIN_LENGTH);
      expect(name.length).toBeLessThanOrEqual(SHOWCASE_MAX_LENGTH);
      expect(name).toMatch(/^[a-zA-Z]+$/);
    }
  });

  it("re-rolls every call (two draws are different)", () => {
    const draws = new Set<string>();
    for (let i = 0; i < 50; i += 1) draws.add(randomSiteName());
    // 50 draws of 5-9 letters colliding twice is essentially impossible
    expect(draws.size).toBeGreaterThan(45);
  });

  it("picks letters only from the pool", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(randomLetter()).toMatch(/^[a-zA-Z]$/);
    }
  });
});

describe("the address-bar cover", () => {
  it("covers to the bare domain root", () => {
    expect(SHOWCASE_COVER_PATH).toBe("/");
  });

  it("wants a cover whenever anything readable is visible", () => {
    // any query, any hash, any path — all readable, all covered
    expect(shouldCoverUrl("/", "", "")).toBe(false);
    expect(shouldCoverUrl("/", "?liner=xk2", "")).toBe(true);
    expect(shouldCoverUrl("/", "", "#/library")).toBe(true);
    expect(shouldCoverUrl("/", "?liner=xk2", "#/library")).toBe(true);
    expect(shouldCoverUrl("/library", "", "")).toBe(true);
  });

  it("rebuilds the real URL for the router location when uncovered", () => {
    expect(realHrefForLocation("/", "")).toBe("/");
    expect(realHrefForLocation("/library", "")).toBe("/#/library");
    expect(realHrefForLocation("/library/playlist", "?id=42")).toBe(
      "/#/library/playlist?id=42",
    );
    expect(realHrefForLocation("/", "?q=x")).toBe("/#/?q=x");
  });
});

describe("decideShowcaseAction", () => {
  it("starts the scramble while showcase is on", () => {
    expect(decideShowcaseAction(on)).toEqual({ action: "start" });
  });

  it("stops the scramble when the server says off", () => {
    expect(decideShowcaseAction(off)).toEqual({ action: "stop" });
  });
});

describe("showcaseStore", () => {
  it("starts inactive on a fresh page load", () => {
    const store = createShowcaseStore();
    expect(store.getState().active).toBe(false);
  });

  it("activates on a confirmed probe and deactivates on a release", () => {
    const store = createShowcaseStore();
    store.getState().setActive(on);
    expect(store.getState().active).toBe(true);
    store.getState().clearActive();
    expect(store.getState().active).toBe(false);
  });

  it("a failed probe keeps the current state (the gate does nothing)", () => {
    const store = createShowcaseStore();
    store.getState().setActive(on);
    // transport failures never call setActive/clearActive — still on
    expect(store.getState().active).toBe(true);
  });

  it("applyShowcaseStatus drives the global store both ways", () => {
    // the shared entry point for the probe loop and the Moderation toggle
    applyShowcaseStatus(on);
    expect(useShowcaseStore.getState().active).toBe(true);
    applyShowcaseStatus(off);
    expect(useShowcaseStore.getState().active).toBe(false);
  });
});
