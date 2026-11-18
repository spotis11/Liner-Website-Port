import { describe, it, expect, beforeEach } from "vitest";
import {
  recordPlaybackEvent,
  recordPlaybackFailure,
  recordPlaybackSuccess,
  getPlaybackDiagnostics,
  clearPlaybackDiagnostics,
  subscribePlaybackDiagnostics,
  resetPlaybackDiagnosticsForTests,
} from "./playbackDiagnostics";

describe("playbackDiagnostics", () => {
  beforeEach(() => {
    localStorage.clear();
    resetPlaybackDiagnosticsForTests();
  });

  it("records newest-first and caps the buffer at 10 entries", () => {
    for (let i = 0; i < 14; i += 1) {
      recordPlaybackEvent("tv", `failure-${i}`, "track");
    }
    const entries = getPlaybackDiagnostics();
    expect(entries).toHaveLength(10);
    expect(entries[0].detail).toBe("failure-13");
    expect(entries[9].detail).toBe("failure-4");
  });

  it("persists to localStorage and reloads", () => {
    recordPlaybackEvent("unresolved", "Sign in to confirm you're not a bot", "Flashback");
    const raw = JSON.parse(localStorage.getItem("liner_playback_diagnostics") || "[]");
    expect(raw[0].stage).toBe("unresolved");

    resetPlaybackDiagnosticsForTests();
    expect(getPlaybackDiagnostics()[0].track).toBe("Flashback");
  });

  it("records failures with error messages", () => {
    recordPlaybackFailure("tv", new Error("YouTube TV player failed with HTTP 403."), "Black Sunrise");
    const entry = getPlaybackDiagnostics()[0];
    expect(entry.stage).toBe("tv");
    expect(entry.detail).toContain("HTTP 403");
    expect(entry.track).toBe("Black Sunrise");
  });

  it("records successes", () => {
    recordPlaybackSuccess("played", "soundcloud stand-in", "Flashback");
    expect(getPlaybackDiagnostics()[0].detail).toBe("soundcloud stand-in");
  });

  it("notifies subscribers and supports unsubscribe", () => {
    const seen: number[] = [];
    const unsubscribe = subscribePlaybackDiagnostics((entries) => seen.push(entries.length));
    recordPlaybackEvent("webremix", "bot check", null);
    unsubscribe();
    recordPlaybackEvent("webremix", "bot check 2", null);
    expect(seen).toEqual([1]);
  });

  it("clears everything", () => {
    recordPlaybackEvent("profile", "LOGIN_REQUIRED", null);
    clearPlaybackDiagnostics();
    expect(getPlaybackDiagnostics()).toHaveLength(0);
    expect(localStorage.getItem("liner_playback_diagnostics")).toBe("[]");
  });
});
