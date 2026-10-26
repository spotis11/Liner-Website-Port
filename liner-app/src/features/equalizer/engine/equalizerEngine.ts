import { pitchShifter } from "@/features/player/engine/pitchShifter";
import { useEqualizerStore } from "../store/equalizerStore";

let initialized = false;

/**
 * True when the equalizer would color the audio right now (enabled AND any
 * parameter deviates from a transparent flat response).
 */
export function isEqActive(): boolean {
  const state = useEqualizerStore.getState();
  if (state.bypassed) return false;
  return (
    state.bands.some((gain) => Math.abs(gain) > 0.01) ||
    Math.abs(state.preampDb) > 0.01 ||
    state.bassBoostPct > 0.01
  );
}

/**
 * Pushes the current store state into the Web Audio graph, attaching it
 * lazily if needed. Safe to call any time; no-ops gracefully before the
 * audio element exists (the runtime re-applies on every load).
 */
export function ensureApplied(): boolean {
  if (typeof window === "undefined") return false;
  const state = useEqualizerStore.getState();
  const applied = pitchShifter.applyEqualizer({
    bypassed: state.bypassed,
    bands: state.bands,
    preampDb: state.preampDb,
    bassBoostPct: state.bassBoostPct,
  });
  return applied;
}

/** subscribes the engine to store changes; call once from the app runtime */
export function initEqualizerEngine(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  useEqualizerStore.subscribe(() => {
    ensureApplied();
  });
  ensureApplied();
}
