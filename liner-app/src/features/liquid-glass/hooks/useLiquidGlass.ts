// App-level sync for the Liquid Glass appearance: starts/stops the
// liquidGL runtime when the store flag flips. Mounted once from App.tsx
// next to AppearanceSync — panes live inside the shell, so the runtime
// simply finds zero panes on views without chrome (login, fullscreen).

import { useEffect } from "react";
import { useLiquidGlassStore } from "../store/liquidGlassStore";
import { startLiquidGlass, stopLiquidGlass } from "../lib/liquidGlassController";

export function useLiquidGlassSync(): boolean {
  const enabled = useLiquidGlassStore((s) => s.enabled);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let stop: (() => void) | null = null;
    startLiquidGlass().then((fn) => {
      if (!active) {
        // Disabled again while the engine chunk was loading.
        stopLiquidGlass();
        return;
      }
      stop = fn;
    });
    return () => {
      active = false;
      stop?.();
      stopLiquidGlass();
    };
  }, [enabled]);

  return enabled;
}

/** Convenience selector for components that drop their own background. */
export function useLiquidGlassEnabled(): boolean {
  return useLiquidGlassStore((s) => s.enabled);
}
