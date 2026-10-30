import { MusicNote } from "@solar-icons/react";
import { VideoLine } from "@mingcute/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useCoverReady, CoverImage } from "@/features/covers";
import { cn } from "@/shared/lib";
import { useTranslation } from "@/languages";
import { usePlayerState } from "../hooks/usePlayerState";
import { findMusicVideoVersion } from "../engine/musicVideoVersion";
import { getTrackVideoId, FullscreenVideoStage } from "./FullscreenVideoStage";
import { VolumePicker } from "./VolumePicker";
import { FullscreenTrackInfo } from "./FullscreenTrackInfo";
import { FullscreenTimeline } from "./FullscreenTimeline";
import { FullscreenTransportControls } from "./FullscreenTransportControls";

interface PlayerUiElementsProps {
  onDuration?: (duration: number) => void;
  onClose?: () => void;
}

export function PlayerUiElements({ onClose }: PlayerUiElementsProps) {
  const { t } = useTranslation();
  const track = usePlayerState().currentTrack;
  const coverUrl = track?.coverUrl || "";
  const isCoverLoaded = useCoverReady(coverUrl);
  const trackId = track?.id ?? null;
  const ownVideoId = getTrackVideoId(track);

  // YouTube-Music-style Song/Video view. The choice is sticky for the
  // session; tracks without a video always fall back to the cover.
  const [viewMode, setViewMode] = useState<"song" | "video">("song");
  useEffect(() => {
    if (!ownVideoId) setViewMode("song");
  }, [ownVideoId]);
  const showVideo = ownVideoId !== null && viewMode === "video";

  // Most tracks carry the *song* id — an art-track video whose frame is a
  // static cover. When the user asks for video, resolve the official music
  // video (YT Music's OMV) and hot-swap to it; until then (or on failure)
  // the track's own video plays.
  const [videoVersions, setVideoVersions] = useState<
    Record<string, string | undefined>
  >({});
  const videoId = (trackId ? videoVersions[trackId] : undefined) ?? ownVideoId;
  const audioVariant = track?.audioVariant;
  useEffect(() => {
    if (!showVideo || !track || !trackId || !ownVideoId) return;
    if (videoVersions[trackId] !== undefined) return;
    let cancelled = false;
    findMusicVideoVersion(track, ownVideoId)
      .then((resolved) => {
        // resolved === null means "no official video found" — remember the
        // own id so we stop re-searching on every render pass
        if (!cancelled) {
          setVideoVersions((prev) => ({
            ...prev,
            [trackId]: resolved ?? ownVideoId,
          }));
        }
      })
      .catch(() => {
        // keep the own id playing; a later toggle retries
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVideo, trackId, ownVideoId, audioVariant]);

  return (
    <div className="flex w-[min(340px,32vw,calc(100vh-340px))] min-w-[240px] flex-col items-stretch">
      {/* song/video toggle — sits on top of the cover, YouTube-Music style */}
      {ownVideoId && (
        <div className="mb-[10px] flex w-full items-center justify-start gap-[8px]">
          <button
            type="button"
            aria-pressed={!showVideo}
            aria-label={t("player.song")}
            title={t("player.song")}
            onClick={() => setViewMode("song")}
            data-no-window-drag
            className={cn(
              "inline-flex h-[32px] shrink-0 items-center gap-[6px] rounded-full border-none px-[14px] backdrop-blur-2xl backdrop-saturate-150 cursor-pointer transition-all duration-200 ease-out active:scale-[0.94]",
              !showVideo
                ? "bg-white/15 text-white"
                : "bg-[#303030]/50 text-white/60 hover:text-white",
            )}
          >
            <MusicNote size={16} />
            <span className="text-[13px] font-[600] leading-none">
              {t("player.song")}
            </span>
          </button>
          <button
            type="button"
            aria-pressed={showVideo}
            aria-label={t("player.video")}
            title={t("player.video")}
            onClick={() => setViewMode("video")}
            data-no-window-drag
            className={cn(
              "inline-flex h-[32px] shrink-0 items-center gap-[6px] rounded-full border-none px-[14px] backdrop-blur-2xl backdrop-saturate-150 cursor-pointer transition-all duration-200 ease-out active:scale-[0.94]",
              showVideo
                ? "bg-white/15 text-white"
                : "bg-[#303030]/50 text-white/60 hover:text-white",
            )}
          >
            <VideoLine size={16} />
            <span className="text-[13px] font-[600] leading-none">
              {t("player.video")}
            </span>
          </button>
        </div>
      )}

      <div className="flex w-full items-center gap-[10px]">
        <div
          className={cn(
            // square like a cover in song view, 16:9 like a video in video view
            showVideo ? "aspect-video" : "aspect-square",
            "relative w-full shrink-0 overflow-hidden rounded-xl bg-black/20",
            coverUrl && !isCoverLoaded && !showVideo && "animate-pulse",
          )}
        >
          {showVideo && videoId ? (
            <FullscreenVideoStage key={videoId} videoId={videoId} track={track} />
          ) : (
            <AnimatePresence>
              <motion.div
                key={track?.id || coverUrl || "empty"}
                initial={{ opacity: 0, filter: "blur(8px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, filter: "blur(8px)" }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="absolute inset-0"
              >
                {coverUrl ? (
                  <CoverImage
                    key={coverUrl}
                    src={coverUrl}
                    alt={track?.title || ""}
                    fill
                    sizes="340px"
                    priority
                    unoptimized
                    className="rounded-xl object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-white/5 text-white/40">
                    <MusicNote size={64} />
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>

      <div className="mt-[24px]">
        <FullscreenTrackInfo onClose={onClose} />
      </div>

      <div className="mt-[22px]">
        <FullscreenTimeline />
      </div>

      <div className="mt-[20px]">
        <FullscreenTransportControls />
      </div>

      <div className="mt-[22px] flex justify-center">
        <VolumePicker
          className="w-[60%]"
          size="sm"
          iconSize={22}
          iconClassName="text-white opacity-80 hover:opacity-100"
        />
      </div>
    </div>
  );
}

export default PlayerUiElements;
