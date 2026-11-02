// Compact Spotify-style player rendered inside the Document Picture-in-
// Picture window (see ../engine/miniPipController.ts). Runs in the same JS
// context as the main app, so it reads the player store and calls
// playerEngine directly.

import { memo, useCallback, useEffect } from "react";
import { SkipNext, SkipPrevious } from "@solar-icons/react";
import { CloseLine, HeartFill, HeartLine } from "@mingcute/react";

import { PlayerMorphIcon, ICON_PLAY, ICON_PAUSE } from "./morphPlayerIcons";
import { usePlayerState } from "../hooks/usePlayerState";
import { playerEngine } from "../engine/playerEngine";
import { usePlayerStore } from "../store/playerStore";
import { CoverImage } from "@/features/covers";
import {
  useIsTrackLiked,
  useLikeTrack,
  useUnlikeTrack,
} from "@/features/library/hooks";
import { isLocalTrackId } from "@/shared/media/local/localTrackIds";
import { useTranslation } from "@/languages";

export interface MiniPipPlayerProps {
  pipWindow: Window | null;
}

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function MiniPipPlayer({ pipWindow }: MiniPipPlayerProps) {
  const { t } = useTranslation();
  const player = usePlayerState();
  const track = player.currentTrack;

  const isPlaying = player.status === "playing";
  const isLoading = player.status === "loading";
  const trackTitle = track?.title ?? t("player.choose_track");
  const trackArtists = track?.artists ?? "";
  const coverUrl = track?.coverUrl || "";
  const durationMs = player.durationMs;
  const positionMs = player.positionMs;

  const isLiked = useIsTrackLiked(track?.id);
  const likeMutation = useLikeTrack();
  const unlikeMutation = useUnlikeTrack();

  // Reflect the playing track in the mini window's title bar.
  useEffect(() => {
    if (!pipWindow) return;
    pipWindow.document.title = track
      ? `${track.title} — ${track.artists}`
      : "Liner — Miniplayer";
  }, [pipWindow, track]);

  const handleLikeToggle = useCallback(() => {
    if (!track) return;
    if (isLiked) {
      unlikeMutation.mutate(track.id);
    } else {
      likeMutation.mutate(track.id);
    }
  }, [track, isLiked, likeMutation, unlikeMutation]);

  const handleSeek = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!durationMs) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (!rect.width) return;
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      playerEngine.seek(ratio * durationMs);
    },
    [durationMs],
  );

  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  const showLike = track !== null && !isLocalTrackId(track.id);

  return (
    <div
      className="flex h-screen w-full flex-col bg-bg-primary text-text-primary select-none"
      style={{ fontFamily: "var(--font-inter), sans-serif" }}
    >
      <div className="flex min-h-0 flex-1 items-center gap-[12px] px-[14px] pt-[10px]">
        <div className="relative h-[64px] w-[64px] shrink-0 overflow-hidden rounded-[10px] bg-bg-elevated">
          {coverUrl ? (
            <CoverImage
              key={coverUrl}
              src={coverUrl}
              alt="Track artwork"
              width={64}
              height={64}
              draggable={false}
              className="h-[64px] w-[64px] object-cover rounded-[10px]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-text-tertiary">
              <SkipNext size={20} />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-[2px]">
          <p className="m-0 truncate text-[14px] font-[500] leading-[18px] text-text-primary">
            {trackTitle}
          </p>
          <p className="m-0 truncate text-[12px] font-[300] leading-[16px] text-text-tertiary">
            {trackArtists}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-[2px]">
          {showLike && (
            <button
              type="button"
              aria-label={isLiked ? t("common.unlike") : t("common.like")}
              className={`inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border-0 bg-transparent p-0 cursor-pointer transition-colors ${
                isLiked
                  ? "text-red-500"
                  : "text-text-secondary hover:text-text-primary"
              }`}
              onClick={handleLikeToggle}
            >
              {isLiked ? <HeartFill size={17} /> : <HeartLine size={17} />}
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-center gap-[14px] pb-[2px] pt-[6px]">
        <button
          type="button"
          aria-label="Previous track"
          className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border-0 bg-transparent p-0 text-text-secondary cursor-pointer hover:text-text-primary transition-colors"
          onClick={() => void playerEngine.skipPrevious()}
        >
          <SkipPrevious size={17} weight="Bold" />
        </button>
        <button
          type="button"
          aria-label={isPlaying ? "Pause" : "Play"}
          className="inline-flex h-[36px] w-[36px] items-center justify-center rounded-full bg-white text-black border-none cursor-pointer transition-transform duration-150 ease-out hover:scale-105 active:scale-[0.96] shadow-sm"
          onClick={() => void playerEngine.togglePlayPause()}
        >
          <span className="relative flex items-center justify-center">
            <PlayerMorphIcon
              icon={isPlaying ? ICON_PAUSE : ICON_PLAY}
              size={15}
            />
            {isLoading && (
              <span
                className="absolute h-[15px] w-[15px] animate-spin rounded-full border-[2px] border-current border-t-transparent"
                aria-label="Loading playback"
              />
            )}
          </span>
        </button>
        <button
          type="button"
          aria-label="Next track"
          className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border-0 bg-transparent p-0 text-text-secondary cursor-pointer hover:text-text-primary transition-colors"
          onClick={() => void playerEngine.skipNext()}
        >
          <SkipNext size={17} weight="Bold" />
        </button>
        <button
          type="button"
          aria-label="Close miniplayer"
          title={t("player.close_miniplayer") || "Close miniplayer"}
          className="ml-[2px] inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border-0 bg-transparent p-0 text-text-tertiary cursor-pointer hover:text-text-primary transition-colors"
          onClick={() => {
            // Closing the window keeps audio playing in the main tab.
            import("../engine/miniPipController").then((m) => m.closeMiniPip());
          }}
        >
          <CloseLine size={17} />
        </button>
      </div>

      <div className="flex items-center gap-[8px] px-[14px] pb-[10px] pt-[4px]">
        <span className="w-[34px] shrink-0 text-right text-[10px] tabular-nums text-text-tertiary">
          {formatTime(positionMs)}
        </span>
        <div
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(durationMs)}
          aria-valuenow={Math.round(positionMs)}
          className="group relative h-[10px] flex-1 cursor-pointer"
          onClick={handleSeek}
        >
          <div className="absolute inset-x-0 top-1/2 h-[4px] -translate-y-1/2 overflow-hidden rounded-full bg-white/15 transition-all group-hover:h-[6px]">
            <div
              className="h-full rounded-full bg-white/85"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
        <span className="w-[34px] shrink-0 text-[10px] tabular-nums text-text-tertiary">
          {formatTime(durationMs)}
        </span>
      </div>
    </div>
  );
}

export default memo(MiniPipPlayer);
