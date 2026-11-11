import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/shared/lib";
import { VolumePicker } from "./VolumePicker";
import { FullscreenCoverArt } from "./FullscreenCoverArt";
import { FullscreenTrackInfo } from "./FullscreenTrackInfo";
import { FullscreenTimeline } from "./FullscreenTimeline";
import { FullscreenTransportControls } from "./FullscreenTransportControls";
import {
  BASE_COLUMN_WIDTH,
  fullscreenColumnScale,
} from "../lib/fullscreenScale";

/**
 * Web adaptation of upstream's electron window-state gate: the web
 * fullscreen player always fills the viewport, so the column scale tracks
 * the window size directly.
 */
function useFullscreenColumnScale(): number {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const update = () =>
      setScale(fullscreenColumnScale(window.innerWidth, window.innerHeight));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return scale;
}

interface PlayerUiElementsProps {
  onDuration?: (duration: number) => void;
  onClose?: () => void;
  layout?: "vertical" | "horizontal";
  /** fork: horizontal column squeezed into the half-width lyrics split —
      keeps the info column at its base width and tightens the gap so the
      cover + controls block never clips inside the pane */
  fitPane?: boolean;
}

const LAYOUT_TRANSITION = {
  duration: 0.5,
  ease: [0.22, 1, 0.36, 1],
} as const;

export function PlayerUiElements({
  onClose,
  layout = "vertical",
  fitPane = false,
}: PlayerUiElementsProps) {
  const scale = useFullscreenColumnScale();
  const horizontal = layout === "horizontal";
  // the scaled-up column only fits full-width — inside the half-width lyrics
  // split it would overflow, so fitPane keeps the base unscaled column
  const scaled = scale > 1 && !(horizontal && fitPane);
  const columnWidth = Math.round(BASE_COLUMN_WIDTH * scale);
  const columnStyle = scaled ? { width: columnWidth } : undefined;
  const columnClass = cn(
    "min-w-[240px]",
    !scaled &&
      (horizontal
        ? fitPane
          ? "w-[min(320px,26vw,calc(100vh-220px))]"
          : "w-[min(360px,34vw,calc(100vh-200px))]"
        : "w-[min(340px,32vw,calc(100vh-340px))]"),
  );

  return (
    <motion.div
      layout
      transition={LAYOUT_TRANSITION}
      className={cn(
        "flex",
        horizontal
          ? fitPane
            ? "flex-row items-stretch gap-[40px]"
            : "flex-row items-stretch gap-[56px]"
          : "flex-col",
        !horizontal && columnClass,
      )}
      style={horizontal ? undefined : columnStyle}
    >
      <motion.div
        layout
        transition={LAYOUT_TRANSITION}
        className={cn("relative", horizontal && "aspect-square shrink-0")}
      >
        <FullscreenCoverArt sizes={`${columnWidth}px`} />
      </motion.div>

      <motion.div
        layout="position"
        transition={LAYOUT_TRANSITION}
        className={cn("flex flex-col", horizontal && columnClass)}
        style={horizontal ? columnStyle : undefined}
      >
        <div className={horizontal ? undefined : "mt-[24px]"}>
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
      </motion.div>
    </motion.div>
  );
}

export default PlayerUiElements;
