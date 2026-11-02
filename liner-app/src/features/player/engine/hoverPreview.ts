import {
  usePlayerStore,
  type PlayerStatus,
} from "../store/playerStore";
import { resolvePlaybackStream, type PlaybackStream } from "./streamResolver";
import type { PlayableTrack } from "./playbackStream";
import { rewriteForWeb } from "@/shared/lib/webProxy";
import { log } from "@/shared/utils/logger";

// How long the pointer must dwell on a song row before its preview starts.
const PREVIEW_DELAY_MS = 450;
// A preview is a teaser, not a listening session: hard cap it.
const PREVIEW_MAX_MS = 30_000;
const FADE_IN_MS = 120;
const FADE_OUT_MS = 180;
const FADE_TICK_MS = 24;

// Previews are only for browsing: they must never step on real playback.
const BLOCKING_STATUSES: PlayerStatus[] = ["playing", "loading"];

function statusBlocksPreview(status: PlayerStatus): boolean {
  return BLOCKING_STATUSES.includes(status);
}

type FadeMode = "in" | "out" | null;

class HoverPreviewController {
  private audio: HTMLAudioElement | null = null;
  private delayTimer: ReturnType<typeof setTimeout> | null = null;
  private capTimer: ReturnType<typeof setTimeout> | null = null;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private fadeMode: FadeMode = null;
  private abortController: AbortController | null = null;
  private activeRelease: (() => void) | null = null;
  private blobUrl: string | null = null;
  // identity of the row the pointer is currently dwelling on
  private hoverKey: string | null = null;
  // identity of the track whose audio is sounding / currently resolving
  private playingKey: string | null = null;
  private storeUnsubscribe: (() => void) | null = null;
  private visibilityHandler: (() => void) | null = null;

  private ensureStoreWatch(): void {
    if (this.storeUnsubscribe || typeof window === "undefined") return;
    this.storeUnsubscribe = usePlayerStore.subscribe((state, prev) => {
      // real playback started (click, resume, media key) -> the preview must go
      if (
        state.status !== prev.status &&
        statusBlocksPreview(state.status) &&
        !statusBlocksPreview(prev.status)
      ) {
        this.stop(true);
        return;
      }
      // setting turned off mid-preview -> stop, and forget the pending hover
      if (prev.hoverPreview && !state.hoverPreview) {
        this.cancelHover();
        this.stop();
      }
    });
    if (typeof document !== "undefined" && !this.visibilityHandler) {
      this.visibilityHandler = () => {
        if (document.hidden) this.stop(true);
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }
  }

  private ensureAudio(): HTMLAudioElement {
    if (this.audio) return this.audio;
    // Deliberately no crossOrigin: a plain preview element does not feed the
    // Web Audio graph (visualizer/pitch), and skipping it keeps playback
    // working even for sources without CORS headers.
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.setAttribute("aria-hidden", "true");
    if (typeof document !== "undefined") {
      document.body.appendChild(this.audio);
    }
    return this.audio;
  }

  private enabled(): boolean {
    return usePlayerStore.getState().hoverPreview;
  }

  private playbackBusy(): boolean {
    return statusBlocksPreview(usePlayerStore.getState().status);
  }

  private clearDelayTimer(): void {
    if (this.delayTimer) {
      clearTimeout(this.delayTimer);
      this.delayTimer = null;
    }
  }

  private clearFade(): void {
    if (this.fadeTimer) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
    this.fadeMode = null;
  }

  private revokeBlob(): void {
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }

  private detachElement(): void {
    const audio = this.audio;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }

  /** Pointer entered a song row. Schedules the preview after a short dwell. */
  hoverStart(track: PlayableTrack): void {
    if (typeof window === "undefined") return;
    this.ensureStoreWatch();
    if (!this.enabled() || this.playbackBusy()) return;

    const key = track.id;
    // same row again without a leave in between: let a running preview be
    if (key === this.hoverKey) return;
    this.cancelHover();

    this.hoverKey = key;
    this.delayTimer = setTimeout(() => {
      this.delayTimer = null;
      void this.begin(track, key);
    }, PREVIEW_DELAY_MS);
  }

  /** Pointer left the row / row unmounted: cancel the schedule and the audio. */
  hoverStop(): void {
    this.cancelHover();
    this.stop();
  }

  /**
   * Row-scoped end (mouseleave / unmount): only winds the preview down when
   * THIS row is the one hovering/sounding — a sibling row unmounting must not
   * kill an unrelated preview.
   */
  hoverEnd(key: string): void {
    if (this.hoverKey !== key && this.playingKey !== key) return;
    this.hoverStop();
  }

  private cancelHover(): void {
    this.clearDelayTimer();
    this.hoverKey = null;
  }

  private async begin(track: PlayableTrack, key: string): Promise<void> {
    if (this.hoverKey !== key) return;
    if (!this.enabled() || this.playbackBusy()) {
      this.hoverStop();
      return;
    }
    this.playingKey = key;
    const controller = new AbortController();
    this.abortController = controller;
    try {
      const stream = await resolvePlaybackStream(track, controller.signal, {
        progressive: true,
      });
      if (controller.signal.aborted || this.playingKey !== key) {
        // superseded while resolving: kill any underlying progressive fetch
        stream.release?.();
        return;
      }
      this.attach(stream, key);
    } catch (error) {
      if (controller.signal.aborted || this.playingKey !== key) return;
      log("yellow", "playback", `hover preview failed: ${String(error)}`);
      this.reset();
    }
  }

  private attach(stream: PlaybackStream, key: string): void {
    const audio = this.ensureAudio();
    const url = stream.blob ? URL.createObjectURL(stream.blob) : stream.url;
    if (stream.blob) this.blobUrl = url;
    this.activeRelease = stream.release ?? null;
    audio.src = rewriteForWeb(url);
    audio.volume = 0;
    audio.load();

    const targetVolume = Math.max(
      0,
      Math.min(1, usePlayerStore.getState().volume),
    );
    audio
      .play()
      .then(() => {
        if (this.playingKey !== key) return;
        this.startFade(targetVolume, FADE_IN_MS, "in", null);
        this.capTimer = setTimeout(() => {
          this.capTimer = null;
          this.stop();
        }, PREVIEW_MAX_MS);
      })
      .catch((error) => {
        // autoplay policy can refuse play() without a prior user gesture —
        // stay silent instead of fighting the browser
        if (this.playingKey !== key) return;
        log("yellow", "playback", `hover preview blocked: ${String(error)}`);
        this.stop(true);
      });
  }

  /**
   * Ramp `audio.volume` towards `target` over `durationMs`. When a fade-out
   * finishes the element is detached and its resources released.
   */
  private startFade(
    target: number,
    durationMs: number,
    mode: Exclude<FadeMode, null>,
    onDone: (() => void) | null,
  ): void {
    const audio = this.audio;
    if (!audio) return;
    this.clearFade();
    this.fadeMode = mode;
    const start = audio.volume;
    const delta = target - start;
    if (durationMs <= 0 || delta === 0) {
      audio.volume = target;
      this.fadeMode = null;
      onDone?.();
      return;
    }
    const startedAt = Date.now();
    this.fadeTimer = setInterval(() => {
      const element = this.audio;
      if (!element) {
        this.clearFade();
        return;
      }
      const progress = Math.min(1, (Date.now() - startedAt) / durationMs);
      element.volume = Math.max(0, Math.min(1, start + delta * progress));
      if (progress >= 1) {
        this.clearFade();
        onDone?.();
      }
    }, FADE_TICK_MS);
  }

  private reset(): void {
    this.clearDelayTimer();
    if (this.capTimer) {
      clearTimeout(this.capTimer);
      this.capTimer = null;
    }
    this.clearFade();
    this.abortController?.abort();
    this.abortController = null;
    this.activeRelease?.();
    this.activeRelease = null;
    this.playingKey = null;
  }

  /** Stop the preview audio. `immediate` skips the fade-out. */
  stop(immediate = false): void {
    // a fade-out is already winding this preview down (unless hard-stopping)
    if (!immediate && this.fadeMode === "out") return;
    this.reset();

    const audio = this.audio;
    if (!audio) return;
    this.revokeBlob();
    if (immediate || audio.paused) {
      this.detachElement();
      return;
    }
    // only tear the element down if no newer preview has taken it over
    this.startFade(0, FADE_OUT_MS, "out", () => {
      if (this.playingKey === null) this.detachElement();
    });
  }

  /** Test / teardown hook. */
  dispose(): void {
    this.stop(true);
    this.cancelHover();
    this.storeUnsubscribe?.();
    this.storeUnsubscribe = null;
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
    this.visibilityHandler = null;
  }
}

export const hoverPreview = new HoverPreviewController();

// exported for tests only
export const __hoverPreviewInternals = {
  PREVIEW_DELAY_MS,
  PREVIEW_MAX_MS,
  statusBlocksPreview,
};
