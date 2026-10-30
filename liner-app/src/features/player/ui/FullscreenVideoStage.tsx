import { useEffect, useRef, useState } from "react";
import { MusicNote } from "@solar-icons/react";
import { toVideoId } from "@/shared/youtube";
import { CoverImage } from "@/features/covers";
import { useTranslation } from "@/languages";
import type { Track } from "@/shared/types";

/**
 * YouTube-Music-style video mode for the fullscreen player.
 *
 * The app's audio always flows through the single #liner-audio element (EQ,
 * pitch shifting, sound wave, lyrics sync all tap it), so the video can never
 * own the soundtrack. Instead the official YouTube video is embedded muted and
 * *mirrored* against #liner-audio: play/pause/seek/rate are copied over and a
 * drift check re-seeks the frame whenever the two wander apart. The result
 * looks and feels like one player — the cover stays for audio-only rows.
 */

/** The current track's YouTube video id, or null when it has none. */
export function getTrackVideoId(track: Pick<Track, "id"> | null): string | null {
  if (!track) return null;
  return toVideoId(track.id);
}

/** How far the mirrored frame may drift from the audio before re-seeking. */
const DRIFT_TOLERANCE_S = 1.2;
/** Mirror polling interval — cheap, and tight enough to feel instant. */
const SYNC_INTERVAL_MS = 250;

type YTPlayer = {
  destroy: () => void;
  getPlayerState: () => string | undefined;
  getCurrentTime: () => number;
  getPlaybackRate: () => number | undefined;
  mute: () => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setPlaybackRate: (rate: number) => void;
};

/** Test-friendly alias for the subset of the YT player we drive. */
export type YTPlayerLike = YTPlayer;

type YTNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      host?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: { target: YTPlayer }) => void;
        onError?: (event: { data: number }) => void;
      };
    },
  ) => YTPlayer;
};

let iframeApiPromise: Promise<YTNamespace> | null = null;

/**
 * Loads (once) the YouTube IFrame Player API. Resolves with the YT namespace
 * from the official onYouTubeIframeAPIReady callback (chain-safe if other
 * code already installed one).
 */
export function loadYoutubeIframeApi(): Promise<YTNamespace> {
  const existing = (window as unknown as { YT?: YTNamespace }).YT;
  if (existing?.Player) return Promise.resolve(existing);
  if (iframeApiPromise) return iframeApiPromise;

  iframeApiPromise = new Promise<YTNamespace>((resolve) => {
    const globalWindow = window as unknown as {
      YT?: YTNamespace;
      onYouTubeIframeAPIReady?: () => void;
    };
    const previous = globalWindow.onYouTubeIframeAPIReady;
    globalWindow.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(globalWindow.YT as YTNamespace);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.head.appendChild(script);
  });
  return iframeApiPromise;
}

function getAudioElement(): HTMLAudioElement | null {
  return document.getElementById("liner-audio") as HTMLAudioElement | null;
}

/** One mirror step — exported for tests. */
export function syncVideoWithAudio(player: YTPlayer, audio: HTMLAudioElement) {
  const state = player.getPlayerState() ?? "";
  const playingStates = new Set(["playing", "buffering"]);
  if (audio.paused && playingStates.has(state)) {
    player.pauseVideo();
    return;
  }
  if (!audio.paused && !playingStates.has(state)) {
    player.playVideo();
    return;
  }
  const videoTime = player.getCurrentTime();
  if (Number.isFinite(videoTime)) {
    const drift = Math.abs(videoTime - audio.currentTime);
    if (drift > DRIFT_TOLERANCE_S) {
      player.seekTo(audio.currentTime, true);
      return;
    }
  }
  const audioRate = audio.playbackRate;
  if (audioRate > 0 && player.getPlaybackRate() !== audioRate) {
    player.setPlaybackRate(audioRate);
  }
}

interface FullscreenVideoStageProps {
  videoId: string;
  track: Track | null;
  className?: string;
}

/**
 * The muted, mirrored YouTube video. Rendered inside the same square frame
 * that otherwise holds the cover art; falls back to the cover (plus a hint)
 * when YouTube refuses embedding for this video.
 */
export function FullscreenVideoStage({
  videoId,
  track,
  className,
}: FullscreenVideoStageProps) {
  const { t } = useTranslation();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Build the player for this video; rebuild when the video changes. The
  // host div is created imperatively because YT.Player *replaces* whatever
  // element it is given — handing it a React-managed node would corrupt the
  // committed tree on unmount.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    let cancelled = false;
    setReady(false);
    setFailed(false);

    const host = document.createElement("div");
    host.style.width = "100%";
    host.style.height = "100%";
    wrapper.appendChild(host);

    loadYoutubeIframeApi()
      .then((YT) => {
        if (cancelled) return;
        playerRef.current = new YT.Player(host, {
          videoId,
          playerVars: {
            // the audio owns the soundtrack — the frame is a silent mirror
            mute: 1,
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            fs: 0,
            iv_load_policy: 3,
            playsinline: 1,
          },
          events: {
            onReady: (event) => {
              if (cancelled) {
                event.target.destroy();
                return;
              }
              event.target.mute();
              const audio = getAudioElement();
              if (audio) {
                event.target.seekTo(audio.currentTime, true);
                if (!audio.paused) event.target.playVideo();
              }
              setReady(true);
            },
            onError: () => {
              if (!cancelled) setFailed(true);
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        // the iframe may already be gone (fast track skipping)
      }
      playerRef.current = null;
      wrapper.innerHTML = "";
    };
  }, [videoId]);

  // Keep the mirror glued to #liner-audio: poll for play/pause/drift/rate and
  // react instantly to seeks.
  useEffect(() => {
    if (!ready || failed) return;

    const interval = window.setInterval(() => {
      const player = playerRef.current;
      const audio = getAudioElement();
      if (player && audio) syncVideoWithAudio(player, audio);
    }, SYNC_INTERVAL_MS);

    const onSeeking = () => {
      const player = playerRef.current;
      const audio = getAudioElement();
      if (player && audio) player.seekTo(audio.currentTime, true);
    };
    const audio = getAudioElement();
    audio?.addEventListener("seeking", onSeeking);

    return () => {
      window.clearInterval(interval);
      audio?.removeEventListener("seeking", onSeeking);
    };
  }, [ready, failed, videoId]);

  const coverUrl = track?.coverUrl || "";
  return (
    <div className={`relative h-full w-full ${className ?? ""}`}>
      {/* fallback cover stays underneath; shown when the video can't embed */}
      {coverUrl ? (
        <CoverImage
          src={coverUrl}
          alt={track?.title || ""}
          fill
          sizes="340px"
          unoptimized
          className="rounded-xl object-cover"
          style={{ opacity: failed ? 1 : 0, transition: "opacity 0.2s" }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-white/5 text-white/40">
          <MusicNote size={64} />
        </div>
      )}
      {failed ? (
        <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
          <span className="rounded-full bg-black/60 px-3 py-1 text-[12px] font-[500] text-white/80 backdrop-blur-md">
            {t("player.video_unavailable")}
          </span>
        </div>
      ) : null}
      <div
        ref={wrapperRef}
        aria-hidden="true"
        className="absolute inset-0 overflow-hidden rounded-xl [&_iframe]:h-full [&_iframe]:w-full [&_iframe]:border-0"
        style={{
          opacity: ready && !failed ? 1 : 0,
          pointerEvents: "none",
          transition: "opacity 0.2s",
        }}
      />
    </div>
  );
}

export default FullscreenVideoStage;
