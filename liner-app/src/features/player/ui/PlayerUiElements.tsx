import { MusicNote } from "@solar-icons/react";
import { VideoLine } from "@mingcute/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useCoverReady, CoverImage } from "@/features/covers";
import { toVideoId } from "@/shared/youtube";
import { findCatalogMatch } from "@/shared/media/matching";
import { cn } from "@/shared/lib";
import { useTranslation } from "@/languages";
import { usePlayerState } from "../hooks/usePlayerState";
import { findMusicVideoCandidates } from "../engine/musicVideoVersion";
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
  const title = (track?.title ?? "").trim();
  const artists = (track?.artists ?? "").trim();

  // YouTube Music shows the Song/Video toggle for every song and swaps to a
  // "video unavailable" state when there is none. We do the same: any track
  // with searchable metadata can have a video — YouTube-sourced tracks
  // already know their id, catalog tracks get resolved on demand.
  const canHaveVideo = Boolean(ownVideoId) || (title.length > 0 && artists.length > 0);

  // The Song/Video choice is sticky for the session.
  const [viewMode, setViewMode] = useState<"song" | "video">("song");
  useEffect(() => {
    if (!canHaveVideo) setViewMode("song");
  }, [canHaveVideo]);
  const showVideo = viewMode === "video" && canHaveVideo;

  // Per-track resolved video candidates (best first — the stage walks the
  // list when YouTube refuses to embed one). undefined = not attempted yet,
  // null = attempted and nothing found (cover + "unavailable" note),
  // a list = ids to embed.
  const [resolvedVideoIds, setResolvedVideoIds] = useState<
    Record<string, string[] | null>
  >({});
  const resolved = trackId ? resolvedVideoIds[trackId] : undefined;
  const videoId = resolved?.[0] ?? ownVideoId;
  const resolving = showVideo && videoId == null && resolved === undefined;
  const audioVariant = track?.audioVariant;

  useEffect(() => {
    if (!showVideo || !track || !trackId) return;
    if (resolvedVideoIds[trackId] !== undefined) return;

    if (ownVideoId) {
      // YouTube-sourced track: its own id plays right away, but most song
      // rows are static art tracks — refine to the official music video
      // (YT Music's OMV) in the background.
      let cancelled = false;
      findMusicVideoCandidates(track, ownVideoId)
        .then((ids) => {
          if (!cancelled) {
            setResolvedVideoIds((prev) => ({
              ...prev,
              // nothing trustworthy matched → keep the track's own video
              [trackId]: ids.length > 0 ? ids : [ownVideoId],
            }));
          }
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }

    // Catalog track (Liner API / SoundCloud / local): deep-search YouTube
    // for the matching video via the same scored matcher the audio
    // stand-in uses, then prefer its official music video.
    let cancelled = false;
    const run = async () => {
      try {
        const outcome = await findCatalogMatch({
          sourceId: track.id,
          title: track.title,
          artists: artists ? [artists] : [],
          ...(track.durationMs > 0 ? { durationMs: track.durationMs } : {}),
        });
        if (cancelled) return;
        const candidate =
          outcome.status === "approved" ? toVideoId(outcome.track.id) : null;
        if (!candidate) {
          setResolvedVideoIds((prev) => ({ ...prev, [trackId]: null }));
          return;
        }
        const omvIds = await findMusicVideoCandidates(track, candidate);
        setResolvedVideoIds((prev) => ({
          ...prev,
          [trackId]: omvIds.length > 0 ? omvIds : [candidate],
        }));
      } catch {
        if (!cancelled) {
          setResolvedVideoIds((prev) => ({ ...prev, [trackId]: null }));
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVideo, trackId, ownVideoId, audioVariant]);

  return (
    <div className="flex w-[min(340px,32vw,calc(100vh-340px))] min-w-[240px] flex-col items-stretch">
      {/* song/video toggle — sits on top of the cover, YouTube-Music style */}
      {canHaveVideo && (
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
            (coverUrl && !isCoverLoaded && !showVideo) || resolving
              ? "animate-pulse"
              : "",
          )}
        >
          {showVideo && videoId ? (
            <FullscreenVideoStage
              key={videoId}
              videoId={videoId}
              alternates={resolved?.slice(1)}
              track={track}
            />
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
          {showVideo && resolved === null ? (
            <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
              <span className="rounded-full bg-black/60 px-3 py-1 text-[12px] font-[500] text-white/80 backdrop-blur-md">
                {t("player.video_unavailable")}
              </span>
            </div>
          ) : null}
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
