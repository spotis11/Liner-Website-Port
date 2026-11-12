import { describe, expect, it } from "vitest";
import {
  SHOWCASE_MAX_LENGTH,
  SHOWCASE_MIN_LENGTH,
  randomLetter,
  randomSiteName,
  randomUrlJunk,
} from "./showcaseName";
import { createShowcaseStore, decideShowcaseAction } from "../store/showcaseStore";
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

describe("randomUrlJunk", () => {
  it("always produces URL-safe alphanumeric junk within the length bounds", () => {
    for (let i = 0; i < 500; i += 1) {
      const junk = randomUrlJunk();
      expect(junk.length).toBeGreaterThanOrEqual(6);
      expect(junk.length).toBeLessThanOrEqual(10);
      expect(junk).toMatch(/^[a-zA-Z0-9]+$/);
    }
  });

  it("re-rolls every call (two draws are different)", () => {
    const draws = new Set<string>();
    for (let i = 0; i < 50; i += 1) draws.add(randomUrlJunk());
    expect(draws.size).toBeGreaterThan(45);
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
});
