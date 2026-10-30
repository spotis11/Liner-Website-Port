import { describe, it, expect, vi } from "vitest";
import { PlaybackTimeoutError } from "./playerRuntime";
import { withDeadline } from "@/shared/utils/withDeadline";

describe("playback watchdog — withDeadline", () => {
  it("passes the value through when the promise settles in time", async () => {
    const result = await withDeadline(
      Promise.resolve("stream"),
      1_000,
      () => new Error("should not fire"),
    );
    expect(result).toBe("stream");
  });

  it("rejects with the deadline error when the promise hangs", async () => {
    vi.useFakeTimers();
    try {
      const hung = new Promise<string>(() => {});
      const attempt = withDeadline(
        hung,
        45_000,
        () => new PlaybackTimeoutError("resolve", "Flashback", 45_000),
      );
      const expectation = expect(attempt).rejects.toThrow(
        'Timed out resolving audio for "Flashback" after 45s.',
      );
      await vi.advanceTimersByTimeAsync(45_001);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not leave an unhandled rejection when the loser rejects late", async () => {
    const errors: unknown[] = [];
    const onUnhandled = (e: unknown) => errors.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      vi.useFakeTimers();
      let rejectLate!: (e: Error) => void;
      const late = new Promise<string>((_, reject) => {
        rejectLate = reject;
      });
      const attempt = withDeadline(
        late,
        1_000,
        () => new Error("deadline"),
      ).catch((e) => `caught:${String((e as Error).message)}`);
      await vi.advanceTimersByTimeAsync(1_001);
      const outcome = await attempt;
      expect(outcome).toBe("caught:deadline");
      rejectLate(new Error("too late"));
      // give the microtask queue a chance to surface an unhandled rejection
      await vi.advanceTimersByTimeAsync(0);
      expect(errors).toEqual([]);
    } finally {
      vi.useRealTimers();
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("still resolves when the loser resolves late", async () => {
    let resolveLate!: (v: string) => void;
    const late = new Promise<string>((resolve) => {
      resolveLate = resolve;
    });
    const attempt = await withDeadline(
      late,
      5,
      () => new Error("deadline"),
    ).catch(() => "deadline-won");
    expect(attempt).toBe("deadline-won");
    resolveLate("too late"); // must not throw
  });
});

describe("PlaybackTimeoutError", () => {
  it("describes the resolve phase", () => {
    const error = new PlaybackTimeoutError("resolve", "Black Sunrise", 45_000);
    expect(error.name).toBe("PlaybackTimeoutError");
    expect(error.message).toContain("Black Sunrise");
    expect(error.message).toContain("45s");
  });

  it("describes the start phase", () => {
    const error = new PlaybackTimeoutError("start", "Black Sunrise", 20_000);
    expect(error.message).toContain("never started");
    expect(error.message).toContain("20s");
  });
});
