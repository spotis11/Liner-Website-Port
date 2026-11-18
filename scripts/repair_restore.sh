#!/usr/bin/env bash
# Post-merge repair pass 1: restore fork-verified versions of the functional
# layer (the per-hunk batch resolutions left duplicated blocks in some files),
# union the shared/ui barrel, drop orphaned window-controls remnants.
set -uo pipefail
cd /home/z/my-project/liner-app

OURS_RESTORE=(
  src/features/discord/hooks/useDiscordSync.ts
  src/features/home/hooks/useDailyMixes.ts
  src/features/home/hooks/usePopularTracks.ts
  src/features/home/hooks/useExploreCollections.ts
  src/features/home/hooks/useHomeBackdrop.ts
  src/features/home/hooks/useListeningNow.ts
  src/features/lyrics/store/lyricsCache.ts
  src/features/lyrics/store/lyricsStore.ts
  src/features/lyrics/engine/lyricsParser.ts
  src/features/lyrics/canvas/buildLines.ts
  src/features/lyrics/canvas/drawLine.ts
  src/features/lyrics/canvas/exitClock.ts
  src/features/lyrics/canvas/lyricsCanvasRenderer.ts
  src/features/lyrics/canvas/lyricsScene.ts
  src/features/lyrics/canvas/sceneLines.ts
  src/features/lyrics/canvas/timing.ts
  src/features/lyrics/canvas/tokens.ts
  src/features/lyrics/canvas/types.ts
  src/features/lyrics/canvas/wrapRuns.ts
  src/features/lyrics/index.ts
  src/features/lyrics/ui/LyricsProviderIsland.tsx
  src/features/library/hooks/useLikedTracks.ts
  src/features/library/hooks/useLibraryMutations.ts
  src/features/library/hooks/index.ts
  src/features/library/ui/modals/ImportReviewModal.tsx
  src/features/library/ui/modals/AddToPlaylistModal.tsx
  src/features/library/ui/modals/CreatePlaylistModal.tsx
  src/features/library/ui/modals/ImportLikesModal.tsx
  src/features/library/ui/ImportingPlaylistCard.tsx
  src/features/library/ui/LibraryGrid.tsx
  src/features/library/ui/LibraryPage.tsx
  src/features/library/ui/OfflineMixCard.tsx
  src/features/library/ui/PlaylistPage.tsx
  src/features/library/local/store/localLibraryStore.ts
  src/features/library/local/hooks/useAudioFileDrop.ts
  src/features/library/local/hooks/useLocalImport.ts
  src/features/library/local/hooks/useLocalTracks.ts
  src/features/library/local/index.ts
  src/features/library/saved/engine/savedTrackSync.ts
  src/features/library/saved/engine/savedTrackSync.test.ts
  src/features/library/saved/store/savedTracksStore.ts
  src/features/library/saved/index.ts
  src/features/library/saved/ui/SavedLikesPage.tsx
  src/features/library/lib/likesCoverPalette.ts
  src/features/library/lib/likesCoverPalette.test.ts
  src/features/home/ui/PopularTracksSection.tsx
  src/features/home/ui/HomePage.tsx
  src/features/home/ui/DailyMixCover.tsx
  src/features/navigation/hooks/useOverlaySyncPlaceholder.ts
  src/features/overlay/hooks/useOverlaySync.test.tsx
  src/features/overlay/hooks/useOverlaySync.ts
  src/features/overlay/ui/OverlayPlayer.tsx
  src/features/touchbar/hooks/useTouchBarSync.test.tsx
  src/features/touchbar/hooks/useTouchBarSync.ts
  src/features/updater/ui/UpdateModal.tsx
  src/features/player/engine/accountPlayback.ts
  src/features/player/engine/exactSongVersion.test.ts
  src/features/player/engine/playbackStream.ts
  src/features/player/engine/playerEngine.ts
  src/features/player/engine/playerRuntime.ts
  src/features/player/engine/streamResolver.test.ts
  src/features/player/engine/streamResolver.ts
  src/features/player/hooks/useSongMenuItems.test.tsx
  src/features/player/hooks/useSongMenuItems.tsx
  src/features/player/ui/MiniPlayer.tsx
  src/features/player/ui/FullscreenPlayer.tsx
  src/features/player/ui/CanvasLyricsView.tsx
  src/features/player/ui/FullscreenTrackInfo.tsx
  src/features/player/ui/LyricsNotchStatus.tsx
  src/features/player/ui/PlayerUiElements.tsx
  src/features/player/ui/SongCard.tsx
  src/features/player/ui/SongCardWithMenu.tsx
  src/features/player/ui/TimelineSlider.tsx
  src/features/player/ui/BetaVisualsWarning.tsx
  src/features/shortcuts/store/shortcutsStore.ts
  src/features/shortcuts/ui/ShortcutRecorder.tsx
  src/features/youtube-auth/ui/YoutubeAccountSwitcher.tsx
  src/features/search/ui/SearchModal.tsx
  src/shared/api/api.ts
  src/shared/api/baseUrl.test.ts
  src/shared/api/baseUrl.ts
  src/shared/api/humanCheck.test.ts
  src/shared/api/humanCheck.ts
  src/shared/api/index.ts
  src/shared/api/requestSigner.ts
  src/shared/api/track.test.ts
  src/shared/config/version.ts
  src/shared/lib/imageTone.ts
  src/shared/lib/index.ts
  src/shared/lib/webProxy.ts
  src/shared/media/ambient/ambientScripts.ts
  src/shared/media/liner/linerPlayback.ts
  src/shared/media/local/index.ts
  src/shared/media/local/localTrack.test.ts
  src/shared/media/local/localTrack.ts
  src/shared/media/local/localTrackIds.ts
  src/shared/storage/audioFormat.ts
  src/shared/storage/linerDb.ts
  src/shared/utils/cacheManager.ts
  src/shared/youtube/innertube/innertubeAudio.test.ts
  src/shared/youtube/innertube/innertubeAudio.ts
  src/shared/youtube/innertube/innertubeClient.test.ts
  src/shared/youtube/innertube/innertubeClient.ts
  src/shared/youtube/innertube/innertubeSearchMapper.ts
  src/shared/youtube/innertube/innertubeTrackMapper.test.ts
  src/shared/youtube/innertube/innertubeTrackMapper.ts
  src/shared/youtube/innertube/streamProbe.ts
  src/features/connectivity/lib/classify.test.ts
  src/features/connectivity/lib/classify.ts
  src/features/connectivity/lib/probe.ts
  src/features/connectivity/ui/ConnectionIssueModal.tsx
  src/features/human-check/store/humanCheckStore.ts
  src/features/human-check/ui/CheckFrame.tsx
  src/features/human-check/ui/HumanCheckNotice.tsx
  src/features/human-check/ui/ShieldBadge.tsx
)

for f in "${OURS_RESTORE[@]}"; do
  if git cat-file -e 86f528e7:"liner-app/$f" 2>/dev/null; then
    git show 86f528e7:"liner-app/$f" > "$f"
    git add "$f"
  else
    echo "NOT-IN-OURS $f"
  fi
done

# orphaned window-controls remnants (website rule: no window controls)
git rm -q -f src/features/navigation/ui/WindowControlsNotch.tsx 2>/dev/null || rm -f src/features/navigation/ui/WindowControlsNotch.tsx
rm -f src/features/lyrics/canvas/untimedLyrics.test.ts
git add -A src/features/lyrics/canvas 2>/dev/null

echo "restore pass done"
