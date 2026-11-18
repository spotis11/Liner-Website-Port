#!/usr/bin/env bash
# Batch-resolve remaining merge conflicts by group policy:
#   ours   = website-verified behavior (relay, engines, stores, hooks)
#   theirs = upstream redesign / desktop-only modules
set -uo pipefail
cd /home/z/my-project/liner-app
RES=/home/z/my-project/scripts/conflicts.py

OURS_FILES=(
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
  src/features/lyrics/engine/lyricsParser.ts
  src/features/lyrics/store/lyricsCache.ts
  src/features/lyrics/store/lyricsStore.ts
  src/features/lyrics/ui/LyricsProviderIsland.tsx
  src/features/lyrics/index.ts
  src/features/home/hooks/useDailyMixes.ts
  src/features/home/hooks/useExploreCollections.ts
  src/features/home/hooks/useHomeBackdrop.ts
  src/features/home/hooks/useListeningNow.ts
  src/features/home/hooks/usePopularTracks.ts
  src/features/human-check/store/humanCheckStore.ts
  src/features/human-check/ui/CheckFrame.tsx
  src/features/human-check/ui/HumanCheckNotice.tsx
  src/features/human-check/ui/ShieldBadge.tsx
  src/features/connectivity/lib/classify.test.ts
  src/features/connectivity/lib/classify.ts
  src/features/connectivity/lib/probe.ts
  src/features/connectivity/ui/ConnectionIssueModal.tsx
  src/features/discord/hooks/useDiscordSync.ts
  src/features/library/hooks/index.ts
  src/features/library/hooks/useLibraryMutations.ts
  src/features/library/hooks/useLikedTracks.ts
  src/features/library/hooks/useLikesCover.ts
  src/features/library/index.ts
  src/features/library/lib/likesCoverPalette.test.ts
  src/features/library/lib/likesCoverPalette.ts
  src/features/library/local/hooks/useAudioFileDrop.ts
  src/features/library/local/hooks/useLocalImport.ts
  src/features/library/local/hooks/useLocalTracks.ts
  src/features/library/local/store/localLibraryStore.ts
  src/features/library/saved/engine/savedTrackSync.test.ts
  src/features/library/saved/engine/savedTrackSync.ts
  src/features/library/saved/index.ts
  src/features/library/saved/store/savedTracksStore.ts
  src/features/library/saved/ui/SavedLikesPage.tsx
  src/features/library/ui/modals/AddToPlaylistModal.tsx
  src/features/library/ui/modals/CreatePlaylistModal.tsx
  src/features/library/ui/modals/ImportLikesModal.tsx
  src/features/library/ui/modals/ImportReviewModal.tsx
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
  src/features/player/engine/accountPlayback.ts
  src/features/player/engine/exactSongVersion.test.ts
  src/features/player/engine/playbackStream.ts
  src/features/player/engine/playerEngine.ts
  src/features/player/engine/playerRuntime.ts
  src/features/player/engine/streamResolver.test.ts
  src/features/player/engine/streamResolver.ts
  src/features/player/hooks/useSongMenuItems.test.tsx
  src/features/player/hooks/useSongMenuItems.tsx
  src/features/shortcuts/store/shortcutsStore.ts
)

THEIRS_FILES=(
  src/features/overlay/hooks/useOverlaySync.test.tsx
  src/features/overlay/hooks/useOverlaySync.ts
  src/features/overlay/ui/OverlayPlayer.tsx
  src/features/touchbar/hooks/useTouchBarSync.test.tsx
  src/features/touchbar/hooks/useTouchBarSync.ts
  src/features/updater/ui/UpdateModal.tsx
)

fail=0
for f in "${OURS_FILES[@]}"; do
  n=$(grep -c "^<<<<<<<" "$f" 2>/dev/null || echo 0)
  if [ "$n" = "0" ]; then echo "SKIP (no markers) $f"; continue; fi
  args=""
  for i in $(seq 1 "$n"); do args="$args ours"; done
  if python3 "$RES" resolve "$f" $args >/dev/null; then git add "$f"; else echo "FAIL $f"; fail=1; fi
done
for f in "${THEIRS_FILES[@]}"; do
  n=$(grep -c "^<<<<<<<" "$f" 2>/dev/null || echo 0)
  if [ "$n" = "0" ]; then echo "SKIP (no markers) $f"; continue; fi
  args=""
  for i in $(seq 1 "$n"); do args="$args theirs"; done
  if python3 "$RES" resolve "$f" $args >/dev/null; then git add "$f"; else echo "FAIL $f"; fail=1; fi
done
echo "remaining: $(git diff --name-only --diff-filter=U | wc -l)"
exit $fail
