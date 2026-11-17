import { useEffect, useState } from "react";
import { loadCoverElement } from "@/features/covers";
import { measureImageTone } from "@/shared/lib/imageTone";

/**
 * Cover-tinted visualizer color (website port of PR #343's look).
 *
 * Upstream's fullscreen bars only *read* as cover-colored because its bright
 * ambient wash shines through their translucent white fill. The website's
 * blurred-cover backdrop sits much darker under the same bg-black/40 dim, so
 * the white bars stay white. The PR's SpectrumVisualizer already accepts a
 * `barColor` prop — derive a translucent tint from the cover's vibrancy-
 * weighted hue here so the bars follow the artwork on any background.
 *
 * Achromatic covers (or tainted-canvas failures) yield `undefined`, which
 * keeps the PR's default white gradient — the neutral look matches upstream
 * on gray/monochrome artwork.
 */
export function useCoverTone(
  coverUrl: string | undefined,
): string | undefined {
  const [barColor, setBarColor] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setBarColor(undefined);
    if (!coverUrl) return;
    void loadCoverElement(coverUrl).then((img) => {
      if (!active || !img) return;
      try {
        const tone = measureImageTone(img);
        // Gray/black-and-white covers → keep the PR's white bars
        if (tone.hue === undefined || tone.colorfulness < 0.06) return;
        const sat = Math.round(
          Math.min(0.85, Math.max(0.45, tone.colorfulness * 1.6)) * 100,
        );
        const light = Math.round((tone.luminance > 0.62 ? 0.62 : 0.55) * 100);
        setBarColor(
          `hsla(${Math.round(tone.hue * 360)}, ${sat}%, ${light}%, 0.45)`,
        );
      } catch {
        // tainted canvas → PR default
      }
    });
    return () => {
      active = false;
    };
  }, [coverUrl]);

  return barColor;
}
