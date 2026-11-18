import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../store/playerStore";
import { resolvePlaybackStream } from "./streamResolver";
import {
  hoverPreview,
  __hoverPreviewInternals,
} from "./hoverPreview";
import type { PlaybackStream } from "./streamResolver";
import type { PlayableTrack } from "./playbackStream";

vi.mock("./streamResolver", () => ({
  resolvePlaybackStream: vi.fn(),
}));

const track = (id: string): PlayableTrack => ({
  id,
  title: `Song ${id}`,
  artists: `Artist ${id}`,
  durationMs: 180_000,
});

function urlStream(url = "https://example.com/audio.mp3"): PlaybackStream {
  return {
    url,
    mimeType: "audio/mpeg",
    codec: "mp3",
    bitrate: 128_000,
    expiresAtMs: null,
  };
}

function blobStream(): PlaybackStream {
  return {
    blob: new Blob(["audio"], { type: "audio/mpeg" }),
    mimeType: "audio/mpeg",
    codec: "mp3",
    bitrate: 128_000,
    expiresAtMs: null,
  };
}

let playSpy: ReturnType<typeof vi.fn>;
let pauseSpy: ReturnType<typeof vi.fn>;
let loadSpy: ReturnType<typeof vi.fn>;
let createdObjectUrls: string[];
let revokedObjectUrls: string[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(resolvePlaybackStream).mockReset();
  usePlayerStore.setState({ hoverPreview: true, status: "idle", volume: 0.8 });

  playSpy = vi.fn(() => Promise.resolve());
  pauseSpy = vi.fn();
  loadSpy = vi.fn();
  window.HTMLMediaElement.prototype.play = playSpy as never;
  window.HTMLMediaElement.prototype.pause = pauseSpy as never;
  window.HTMLMediaElement.prototype.load = loadSpy as never;

  createdObjectUrls = [];
  revokedObjectUrls = [];
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:mock-${createdObjectUrls.length}`;
    createdObjectUrls.push(url);
    return url;
  }) as never;
  URL.revokeObjectURL = vi.fn((url: string) => {
    revokedObjectUrls.push(url);
  }) as never;
});

afterEach(() => {
  hoverPreview.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function startPreview(id = "a") {
  hoverPreview.hoverStart(track(id));
  await vi.advanceTimersByTimeAsync(
    __hoverPreviewInternals.PREVIEW_DELAY_MS + 10,
  );
}

describe("hoverPreview", () => {
  it("does not resolve anything while a song is playing or loading", async () => {
    usePlayerStore.setState({ status: "playing" });
    await startPreview();
    expect(resolvePlaybackStream).not.toHaveBeenCalled();

    usePlayerStore.setState({ status: "loading" });
    await startPreview("b");
    expect(resolvePlaybackStream).not.toHaveBeenCalled();
  });

  it("does not resolve anything when the setting is off", async () => {
    usePlayerStore.setState({ hoverPreview: false });
    await startPreview();
    expect(resolvePlaybackStream).not.toHaveBeenCalled();
  });

  it("cancels the scheduled preview when the pointer leaves before the delay", async () => {
    hoverPreview.hoverStart(track("a"));
    await vi.advanceTimersByTimeAsync(100);
    hoverPreview.hoverStop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(resolvePlaybackStream).not.toHaveBeenCalled();
  });

  it("plays a short preview after the dwell delay", async () => {
    vi.mocked(resolvePlaybackStream).mockResolvedValue(urlStream());
    await startPreview();

    expect(resolvePlaybackStream).toHaveBeenCalledWith(
      track("a"),
      expect.any(AbortSignal),
      { progressive: true },
    );
    const audio = document.querySelector("audio[aria-hidden='true']");
    expect(audio).not.toBeNull();
    expect((audio as HTMLAudioElement).src).toBe("https://example.com/audio.mp3");
    expect(playSpy).toHaveBeenCalled();
  });

  it("rewrites remote media urls through the web media proxy", async () => {
    vi.mocked(resolvePlaybackStream).mockResolvedValue(
      urlStream("https://r5---example.googlevideo.com/videoplayback?x=1"),
    );
    await startPreview();
    const audio = document.querySelector("audio[aria-hidden='true']");
    // jsdom resolves the relative src property; the raw attribute is relative
    expect((audio as HTMLAudioElement).getAttribute("src")).toBe(
      "/api/media?u=" +
        encodeURIComponent(
          "https://r5---example.googlevideo.com/videoplayback?x=1",
        ),
    );
  });

  it("plays blob streams via an object url and revokes it on stop", async () => {
    vi.mocked(resolvePlaybackStream).mockResolvedValue(blobStream());
    await startPreview();
    const audio = document.querySelector("audio[aria-hidden='true']")!;
    expect(audio.getAttribute("src")).toBe("blob:mock-0");
    expect(createdObjectUrls).toHaveLength(1);

    hoverPreview.hoverStop();
    expect(revokedObjectUrls).toEqual(["blob:mock-0"]);
    expect(audio.getAttribute("src")).toBeNull();
  });

  it("stops the preview as soon as real playback starts", async () => {
    vi.mocked(resolvePlaybackStream).mockResolvedValue(urlStream());
    await startPreview();
    const audio = document.querySelector("audio[aria-hidden='true']")!;

    usePlayerStore.setState({ status: "playing" });
    // immediate stop: no fade grace period
    expect(pauseSpy).toHaveBeenCalled();
    expect(audio.getAttribute("src")).toBeNull();
  });

  it("does not start a preview whose dwell ended with playback already active", async () => {
    hoverPreview.hoverStart(track("a"));
    usePlayerStore.setState({ status: "playing" });
    await vi.advanceTimersByTimeAsync(
      __hoverPreviewInternals.PREVIEW_DELAY_MS + 10,
    );
    expect(resolvePlaybackStream).not.toHaveBeenCalled();
  });

  it("hoverEnd from a sibling row does not kill the active preview", async () => {
    vi.mocked(resolvePlaybackStream).mockResolvedValue(urlStream());
    await startPreview("a");
    const audio = document.querySelector("audio[aria-hidden='true']")!;

    hoverPreview.hoverEnd("b");
    expect(audio.getAttribute("src")).toBe("https://example.com/audio.mp3");

    hoverPreview.hoverEnd("a");
    expect(audio.getAttribute("src")).toBeNull();
  });

  it("switching rows stops the previous preview", async () => {
    vi.mocked(resolvePlaybackStream).mockResolvedValue(urlStream());
    await startPreview("a");
    const audio = document.querySelector("audio[aria-hidden='true']")!;
    expect(audio.getAttribute("src")).toBe("https://example.com/audio.mp3");

    // realistic pointer order: leaving the old row fires before the new enter
    hoverPreview.hoverEnd("a");
    hoverPreview.hoverStart(track("b"));
    await vi.advanceTimersByTimeAsync(
      __hoverPreviewInternals.PREVIEW_DELAY_MS + 10,
    );
    expect(resolvePlaybackStream).toHaveBeenCalledTimes(2);
  });

  it("silently survives a failing stream resolution", async () => {
    vi.mocked(resolvePlaybackStream).mockRejectedValue(
      new Error("resolution failed"),
    );
    await startPreview();
    expect(playSpy).not.toHaveBeenCalled();
    // controller stays usable for the next hover
    vi.mocked(resolvePlaybackStream).mockResolvedValue(urlStream());
    await startPreview("b");
    expect(playSpy).toHaveBeenCalled();
  });

  it("stops previewing when the setting is turned off mid-preview", async () => {
    vi.mocked(resolvePlaybackStream).mockResolvedValue(urlStream());
    await startPreview();
    const audio = document.querySelector("audio[aria-hidden='true']")!;

    usePlayerStore.setState({ hoverPreview: false });
    expect(audio.getAttribute("src")).toBeNull();

    // and a new hover does nothing while off
    await startPreview("c");
    expect(resolvePlaybackStream).toHaveBeenCalledTimes(1);
  });
});
