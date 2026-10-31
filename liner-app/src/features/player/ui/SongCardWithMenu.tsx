import { memo, useCallback, useMemo, useState } from "react";
import SongCard from "./SongCard";
import { useSongMenuItems } from "../hooks/useSongMenuItems";
import { playerEngine } from "../engine/playerEngine";
import type { PlayableTrack } from "../engine/playbackStream";
import { usePlayerStore } from "../store/playerStore";
import { TrackDownloadButton } from "@/features/downloads";
import {
  useLikeTrack,
  useUnlikeTrack,
} from "@/features/library/hooks/useLibraryMutations";
import { useIsTrackLiked } from "@/features/library/hooks/useIsTrackLiked";
import { useToast } from "@/shared/ui";
import { useTranslation } from "@/languages";

import type { TrackArtist } from "@/shared/types";

export interface SongCardWithMenuProps {
  id?: string;
  title: string;
  artists: string;
  artistId?: string;
  artistList?: TrackArtist[];
  coverUrl: string;
  className?: string;
  onPlay?: () => void;
  duration?: string;
  durationMs?: number;
  releaseDate?: string;
  explicit?: boolean;
  hideArtists?: boolean;
  imageShape?: "square" | "circle";
  trackNumber?: number;
  repostedBy?: string;
  searchType?: "track" | "album" | "artist" | "playlist";
  totalTracks?: number;
  playlistId?: string;
  playlistItemId?: string;
  playlistTitle?: string;
  onNavigate?: () => void;
  compact?: boolean;
  icon?: React.ReactNode;
  showReorderHandle?: boolean;
  onGrabStart?: (e: React.PointerEvent<HTMLDivElement>) => void;
  highlight?: string;
  trailingAction?: React.ReactNode;
}

function SongCardWithMenu({
  id,
  title,
  artists,
  artistId,
  artistList,
  coverUrl,
  className,
  onPlay,
  duration,
  durationMs,
  releaseDate,
  explicit,
  hideArtists,
  imageShape,
  trackNumber,
  repostedBy,
  searchType,
  totalTracks,
  playlistId,
  playlistItemId,
  playlistTitle,
  onNavigate,
  compact,
  icon,
  showReorderHandle,
  onGrabStart,
  highlight,
  trailingAction,
}: SongCardWithMenuProps) {
  const resolvedDurationMs = useMemo(() => {
    if (durationMs !== undefined) return durationMs;
    if (!duration) return 0;
    const parts = duration.split(":").map(Number);
    if (parts.length === 2) {
      return (parts[0] * 60 + parts[1]) * 1000;
    }
    if (parts.length === 3) {
      return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    }
    return 0;
  }, [duration, durationMs]);

  const menuItems = useSongMenuItems({
    id,
    title,
    artists,
    coverUrl,
    duration,
    durationMs: resolvedDurationMs,
    searchType,
    totalTracks,
    playlistId,
    playlistItemId,
    playlistTitle,
  });

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // hovering the row auditions this track (only when nothing is playing)
  const previewTrack = useMemo<PlayableTrack | undefined>(() => {
    if (!id || !onPlay) return undefined;
    return { id, title, artists: artists ?? "", durationMs: resolvedDurationMs };
  }, [id, title, artists, resolvedDurationMs, onPlay]);

  const { t } = useTranslation();
  const { toast } = useToast();
  const trackDoubleClickBehavior = usePlayerStore(
    (state) => state.trackDoubleClickBehavior,
  );

  // liked-state heart ("see which songs I like in an album/playlist"):
  // wired automatically for every row with a track id — red filled heart when
  // liked, outline heart on hover to like from the row itself
  const likedEntry = useIsTrackLiked(id);
  const likeMutation = useLikeTrack();
  const unlikeMutation = useUnlikeTrack();

  const handleToggleLike = useCallback(() => {
    if (!id) return;
    if (likedEntry) {
      unlikeMutation.mutate(id);
    } else {
      likeMutation.mutate(id);
    }
  }, [id, likedEntry, likeMutation, unlikeMutation]);

  const handleDoubleClick = useCallback(() => {
    if (!id) return;
    if (trackDoubleClickBehavior === "queue") {
      playerEngine.addToQueue({
        id,
        title,
        artists,
        coverUrl,
        durationMs: resolvedDurationMs,
        playCount: 0,
      });
      toast(t("common.added_to_queue"), "checkmark", {
        description: artists ? `${title} — ${artists}` : title,
      });
    } else if (onPlay) {
      onPlay();
    }
  }, [
    trackDoubleClickBehavior,
    id,
    title,
    artists,
    coverUrl,
    resolvedDurationMs,
    onPlay,
    toast,
    t,
  ]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (menuItems.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      setMenuPosition({ x: e.clientX, y: e.clientY });
      setMenuOpen(true);
    },
    [menuItems],
  );

  const handleMenuOpenChange = useCallback((isOpen: boolean) => {
    setMenuOpen(isOpen);
    if (!isOpen) setMenuPosition(null);
  }, []);

  return (
    <SongCard
      id={id}
      title={title}
      highlight={highlight}
      artists={artists}
      artistId={artistId}
      artistList={artistList}
      coverUrl={coverUrl}
      className={className}
      onPlay={onPlay}
      onDoubleClick={handleDoubleClick}
      duration={duration}
      releaseDate={releaseDate}
      explicit={explicit}
      hideArtists={hideArtists}
      imageShape={imageShape}
      trackNumber={trackNumber}
      repostedBy={repostedBy}
      menuItems={menuItems}
      menuOpen={menuOpen}
      onMenuOpenChange={handleMenuOpenChange}
      onContextMenu={handleContextMenu}
      menuPosition={menuPosition}
      onNavigate={onNavigate}
      compact={compact}
      icon={icon}
      showReorderHandle={showReorderHandle}
      onGrabStart={onGrabStart}
      trailingAction={
        <>
          {id && !compact && (
            <TrackDownloadButton
              track={{
                id,
                title,
                artists,
                coverUrl,
                durationMs: resolvedDurationMs,
              }}
            />
          )}
          {trailingAction}
        </>
      }
      previewTrack={previewTrack}
      liked={likedEntry}
      onToggleLike={id ? handleToggleLike : undefined}
    />
  );
}

export default memo(SongCardWithMenu);
