// Liquid Glass store — the "real liquid glass" appearance switch.
//
// When enabled, the app chrome (mini player bar, queue drawer) is rendered as
// genuine refracting glass panes by the liquidGL library (WebGPU/WebGL with a
// frosted CSS fallback) — see features/liquid-glass/lib/liquidGlassController.
//
// 2026-11-28 (owner request): with no saved preference, MOBILE devices default
// to enabled — the Evi liquid-glass design ships to phones out of the box —
// while desktop keeps the classic chrome. An explicit toggle in Appearance
// (either value, persisted) always wins over the device default.
//
// Persistence mirrors appearanceStore: synchronous, tolerant of corrupt
// records / storage outages. The storage key is NEW (v1) so legacy records
// from the removed CSS-imitation feature never re-enable this one.

import { create } from "zustand";

export const LIQUID_GLASS_STORAGE_KEY = "liner_web_liquid_glass_v1";

export interface LiquidGlassState {
  /** Real liquidGL panes on the app chrome. */
  enabled: boolean;
  setEnabled: (value: boolean) => void;
}

interface PersistedLiquidGlass {
  /** null = no explicit preference recorded (device default applies). */
  enabled: boolean | null;
}

/** True on phones/tablets: coarse pointer or a narrow viewport. */
export function prefersMobileChrome(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const coarse = window.matchMedia?.("(pointer: coarse)").matches === true;
    const narrow = window.matchMedia?.("(max-width: 768px)").matches === true;
    return coarse || narrow;
  } catch {
    return false;
  }
}

function readPersisted(storage: Storage | null): PersistedLiquidGlass {
  if (!storage) return { enabled: null };
  try {
    const raw = storage.getItem(LIQUID_GLASS_STORAGE_KEY);
    if (!raw) return { enabled: null };
    const parsed = JSON.parse(raw) as Partial<PersistedLiquidGlass> | null;
    if (!parsed || typeof parsed !== "object") return { enabled: null };
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : null,
    };
  } catch {
    return { enabled: null };
  }
}

function writePersisted(storage: Storage | null, value: PersistedLiquidGlass) {
  if (!storage) return;
  try {
    storage.setItem(LIQUID_GLASS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage outages (private mode / quota) must never crash the app.
  }
}

function defaultStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createLiquidGlassStore(
  storage: Storage | null = defaultStorage(),
) {
  const initial = readPersisted(storage);
  const persist = (state: Partial<LiquidGlassState>): void => {
    writePersisted(storage, {
      enabled: state.enabled ?? (readPersisted(storage).enabled ?? false),
    });
  };

  return create<LiquidGlassState>()((set) => ({
    enabled: initial.enabled ?? prefersMobileChrome(),
    setEnabled: (value) => {
      set({ enabled: value });
      persist({ enabled: value });
    },
  }));
}

/** Default singleton store. */
export const useLiquidGlassStore = createLiquidGlassStore();
