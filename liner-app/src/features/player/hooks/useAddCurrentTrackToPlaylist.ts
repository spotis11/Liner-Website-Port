import { useCallback } from "react";
import { usePlayerStore } from "../store/playerStore";
import { useModalStore } from "@/features/library/store/modalStore";

/**
 * "Add to playlist" entry point for the currently loaded track.
 *
 * Used by the player bar "+" button (next to the like heart) and the
 * fullscreen player track info. Opens the shared AddToPlaylistModal where
 * the user picks which playlist to add the track to.
 */
export function useAddCurrentTrackToPlaylist() {
  const currentTrack = usePlayerStore((state) => state.currentTrack);

  const openAddToPlaylist = useCallback(() => {
    if (!currentTrack?.id) return;
    useModalStore.getState().openAddToPlaylist({
      id: currentTrack.id,
      title: currentTrack.title,
      artists: currentTrack.artists,
      coverUrl: currentTrack.coverUrl,
      durationMs: currentTrack.durationMs,
    });
  }, [currentTrack]);

  return {
    canAddToPlaylist: Boolean(currentTrack?.id),
    openAddToPlaylist,
  };
}
