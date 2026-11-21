import { useCallback, useRef } from "react";
import { AddLine } from "@mingcute/react";
import {
  useIsTrackLiked,
  useLikeTrack,
  useUnlikeTrack,
} from "@/features/library/hooks";
import { useAddCurrentTrackToPlaylist } from "../hooks/useAddCurrentTrackToPlaylist";
import { useTranslation } from "@/languages";
import { usePlayerStore } from "../store/playerStore";
import { useGlassBlur } from "../store/visualModeStore";
import { cn } from "@/shared/lib";
import { LikeMorphIcon } from "./LikeMorphIcon";
import { launchLikeBurst } from "./LikeBurst";

const actionButtonClass =
  "relative inline-flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[10px] border-none bg-white/[0.06] cursor-pointer text-white transition-colors duration-200 ease-out hover:bg-white/[0.12] active:scale-[0.92]";

const sharedGlass = (glassBlur: boolean) =>
  glassBlur && "backdrop-blur-xl backdrop-brightness-[1.15]";

/**
 * Like + add-to-playlist actions for the fullscreen player, extracted from
 * the track-info block when it went centered (evi layout): they now flank
 * the volume picker in the utility row under the transport controls, so the
 * features stay one click away without cluttering the centered title block.
 */
export function FullscreenLikeButton() {
  const { t } = useTranslation();
  const track = usePlayerStore((s) => s.currentTrack);
  const glassBlur = useGlassBlur();

  const isLiked = useIsTrackLiked(track?.id);
  const likeMutation = useLikeTrack();
  const unlikeMutation = useUnlikeTrack();
  const togglingRef = useRef(false);
  const likeButtonRef = useRef<HTMLButtonElement>(null);

  const handleLikeToggle = useCallback(() => {
    if (!track || togglingRef.current) return;
    togglingRef.current = true;
    const onSettled = () => {
      togglingRef.current = false;
    };
    if (isLiked) {
      unlikeMutation.mutate(track.id, { onSettled });
    } else {
      // Mochy-style like burst: the heart leaves THIS button's box, thumps
      // red at the centre of the screen and dives back into the same box.
      // Unliking is quiet.
      launchLikeBurst(likeButtonRef.current);
      likeMutation.mutate(track.id, { onSettled });
    }
  }, [track, isLiked, likeMutation, unlikeMutation]);

  return (
    <button
      type="button"
      aria-label={isLiked ? t("common.unlike") : t("common.like")}
      onClick={handleLikeToggle}
      ref={likeButtonRef}
      className={cn(actionButtonClass, sharedGlass(glassBlur))}
    >
      <LikeMorphIcon liked={Boolean(isLiked)} size={18} />
    </button>
  );
}

export function FullscreenAddButton() {
  const { t } = useTranslation();
  const glassBlur = useGlassBlur();
  const { openAddToPlaylist } = useAddCurrentTrackToPlaylist();

  return (
    <button
      type="button"
      aria-label={t("common.add_to_playlist")}
      title={t("common.add_to_playlist")}
      onClick={openAddToPlaylist}
      className={cn(actionButtonClass, sharedGlass(glassBlur))}
    >
      <AddLine size={18} />
    </button>
  );
}
