// LiquidGlassPane — the decorative pane that becomes a real liquidGL lens.
//
// Render it as the FIRST child of the component being glassified (the mini
// player bar, the queue drawer panel). It is position:fixed (out of flow —
// zero layout impact), pointer-events:none, and carries no visuals of its
// own: liquidGL appends its WebGPU/WebGL canvas inside it, so the glass
// paints exactly where the controller glues this pane: over the parent's
// rect. The parent should also carry data-liquid-ignore so its own content
// is excluded from the refraction snapshot (crisp chrome over glass).
//
// Geometry lives in CSS custom properties written by the controller and
// consumed by the [data-liquid-glass-pane] rule in globals.css — React never
// manages those, so reconciliation cannot clobber the runtime's writes.

import { useId, type CSSProperties } from "react";
import { LIQUID_GLASS_PANE_ATTR } from "../lib/liquidGlassController";

const BASE_STYLE: CSSProperties = {
  position: "fixed",
  pointerEvents: "none",
  zIndex: 0,
  // Geometry (left/top/width/height/radius) comes from the
  // [data-liquid-glass-pane] rule in globals.css via --lg-* custom
  // properties written by the runtime controller — deliberately NOT inline
  // React styles, so React and the controller never fight over them. Until
  // the first measurement lands the rule keeps the pane invisible.
};

export function LiquidGlassPane() {
  const id = useId();
  return (
    <div
      {...{ [LIQUID_GLASS_PANE_ATTR]: id }}
      aria-hidden="true"
      style={BASE_STYLE}
    />
  );
}
