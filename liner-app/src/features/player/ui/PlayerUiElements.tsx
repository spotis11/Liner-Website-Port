import { MusicNote } from "@solar-icons/react";
import { AnimatePresence, motion } from "framer-motion";
import { useCoverReady, CoverImage } from "@/features/covers";
import { cn } from "@/shared/lib";
import { usePlayerState } from "../hooks/usePlayerState";
import { VolumePicker } from "./VolumePicker";
import { FullscreenTrackInfo } from "./FullscreenTrackInfo";
import { FullscreenTimeline } from "./FullscreenTimeline";
import { FullscreenTransportControls } from "./FullscreenTransportControls";

interface PlayerUiElementsProps {
  onDuration?: (duration: number) => void;
  onClose?: () => void;
}

export function PlayerUiElements({ onClose }: PlayerUiElementsProps) {
  const track = usePlayerState().currentTrack;
  const coverUrl = track?.coverUrl || "";
  const isCoverLoaded = useCoverReady(coverUrl);

  return (
    <div className="flex w-[min(340px,32vw,calc(100vh-340px))] min-w-[240px] flex-col items-stretch">
      <div
        className={cn(
          "relative aspect-square w-full shrink-0 overflow-hidden rounded-xl bg-black/20",
          coverUrl && !isCoverLoaded && "animate-pulse",
        )}
      >
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
