import { useEffect, useRef, useState } from "react";
import { toVideoId } from "@/shared/youtube/innertube/innertubeAudio";
import { resolveVideoStream } from "@/shared/youtube/innertube/innertubeVideo";
import { useAmbientEnabled } from "../store/visualModeStore";
import { usePlayerStore } from "../store/playerStore";

/** audio and video clocks drift apart slowly — resync past this */
const SYNC_DRIFT_S = 0.35;
const SYNC_POLL_MS = 500;

interface FullscreenVideoLayerProps {
  trackId: string | undefined;
  /** the row says it is an official music video (Track.audioVariant) */
  hasVideo: boolean;
}

/**
 * evi 0.1.29's fullscreen "video thing": official music videos play their
 * clip as the fullscreen backdrop. Muted (the audio element owns the sound),
 * frame-synced to #liner-audio, dimmed by the same black/40 scrim the ambient
 * layer sits under — evi's own clip backdrop, minus its "Report sync" button
 * and "idle" badge. Anything missing — no clip on the row, dead stream, lite
 * visual mode — renders nothing and leaves the blurred cover + ambient
 * untouched, so the feature can never take the player down.
 */
export function FullscreenVideoLayer({
  trackId,
  hasVideo,
}: FullscreenVideoLayerProps) {
  const enabled = useAmbientEnabled();
  const playing = usePlayerStore((s) => s.status === "playing");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const videoId = enabled && hasVideo && trackId ? toVideoId(trackId) : null;

  useEffect(() => {
    setUrl(null);
    setReady(false);
    if (!videoId) return;
    const controller = new AbortController();
    let active = true;
    void resolveVideoStream(videoId, { signal: controller.signal })
      .then((stream) => {
        if (active) setUrl(stream.url);
      })
      .catch(() => {
        /* no backdrop is a fine outcome — the ambient layer stays up */
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [videoId]);

  // frame-sync: keep the muted clip locked to the audio clock. Polling is
  // the safety net; a user scrub snaps immediately via the "seeked" event.
  useEffect(() => {
    if (!url) return;
    const sync = () => {
      const audio = document.getElementById(
        "liner-audio",
      ) as HTMLAudioElement | null;
      const video = videoRef.current;
      if (
        !audio ||
        !video ||
        video.readyState < 2 ||
        Number.isNaN(audio.currentTime)
      )
        return;
      if (Math.abs(video.currentTime - audio.currentTime) > SYNC_DRIFT_S) {
        video.currentTime = audio.currentTime;
      }
      if (video.playbackRate !== audio.playbackRate) {
        video.playbackRate = audio.playbackRate;
      }
    };
    const timer = window.setInterval(sync, SYNC_POLL_MS);
    const audio = document.getElementById("liner-audio");
    audio?.addEventListener("seeked", sync);
    return () => {
      window.clearInterval(timer);
      audio?.removeEventListener("seeked", sync);
    };
  }, [url]);

  // follow the transport — play/pause with the audio element
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url || !ready) return;
    if (playing) void video.play().catch(() => undefined);
    else video.pause();
  }, [playing, url, ready]);

  if (!url) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-700 ease-out"
      style={{ opacity: ready ? 1 : 0 }}
    >
      <video
        ref={videoRef}
        src={url}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        onCanPlay={() => setReady(true)}
        className="h-full w-full object-cover"
      />
    </div>
  );
}

export default FullscreenVideoLayer;
