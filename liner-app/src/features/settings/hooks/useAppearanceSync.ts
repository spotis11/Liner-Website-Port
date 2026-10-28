// Keeps the appearance store in sync with the rest of the app:
// - re-applies the active color theme after boot / HMR
// - enforces the interlock rule: a custom wallpaper is NOT allowed while a
//   color theme is applied -> if one sneaks in (e.g. broadcast from a stale
//   tab), it is cleared immediately.

import { useEffect } from "react";
import {
  useAppearanceStore,
  selectIsColorThemeActive,
  applyColorThemeToDocument,
} from "../store/appearanceStore";
import { useCustomizationStore } from "../store/customizationStore";

export function useAppearanceSync(): boolean {
  const colorThemeActive = useAppearanceStore(selectIsColorThemeActive);
  const colorThemeId = useAppearanceStore((s) => s.colorThemeId);
  const backgroundImage = useCustomizationStore((s) => s.backgroundImage);
  const setBackgroundImage = useCustomizationStore((s) => s.setBackgroundImage);

  // Re-apply on mount / theme change (idempotent, also covers HMR).
  useEffect(() => {
    applyColorThemeToDocument(colorThemeId);
  }, [colorThemeId]);

  // Interlock: theme applied -> wallpaper must go.
  useEffect(() => {
    if (colorThemeActive && backgroundImage) {
      setBackgroundImage(null);
    }
  }, [colorThemeActive, backgroundImage, setBackgroundImage]);

  return colorThemeActive;
}
