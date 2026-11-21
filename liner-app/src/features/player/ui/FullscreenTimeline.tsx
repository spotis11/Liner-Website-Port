import { useState } from "react";
import { usePlayerState } from "../hooks/usePlayerState";
import { playerEngine } from "../engine/playerEngine";
import { TimelineSlider, formatPlaybackTime } from "./TimelineSlider";

export function FullscreenTimeline() {
  const player = usePlayerState();
  const [scrubMs, setScrubMs] = useState<number | null>(null);

  // evi-style countdown: the right label counts DOWN as "-1:38" instead of
  // showing the total duration; scrubbing previews the target position.
  const shownMs = scrubMs ?? player.positionMs;
  const remainingMs = Math.max(0, player.durationMs - shownMs);

  return (
    <div className="flex w-full flex-col gap-[4px]">
      <TimelineSlider
        positionMs={player.positionMs}
        durationMs={player.durationMs}
        onScrub={setScrubMs}
        onSeek={(pos) => {
          setScrubMs(null);
          playerEngine.seek(pos);
        }}
        size="md"
        className="w-full"
      />
      <div className="flex items-center justify-between font-montserrat text-caption font-[500] tabular-nums text-white/70">
        <span>{formatPlaybackTime(shownMs)}</span>
        <span>-{formatPlaybackTime(remainingMs)}</span>
      </div>
    </div>
  );
}
