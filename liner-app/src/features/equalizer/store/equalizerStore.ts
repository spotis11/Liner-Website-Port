import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  EQ_PRESET_BANDS,
  clampBandGain,
  detectPresetId,
  type EqPresetId,
} from "../lib/presets";

const STORAGE_KEY = "liner.equalizer.v1";

interface EqualizerState {
  /** true = dry bypass path, filters idle */
  bypassed: boolean;
  /** 10 band gains in dB, -12..+12 */
  bands: number[];
  /** master preamp in dB, -12..+12 */
  preampDb: number;
  /** bass boost amount, 0..100 */
  bassBoostPct: number;
  preset: EqPresetId;

  setBypassed: (bypassed: boolean) => void;
  setBand: (index: number, gain: number) => void;
  setPreamp: (db: number) => void;
  setBassBoost: (pct: number) => void;
  applyPreset: (preset: Exclude<EqPresetId, "custom">) => void;
  resetFlat: () => void;
}

const DEFAULT_BANDS = Object.freeze([...EQ_PRESET_BANDS.flat]);

function sanitizeBands(bands: unknown): number[] {
  if (!Array.isArray(bands) || bands.length !== DEFAULT_BANDS.length) {
    return [...DEFAULT_BANDS];
  }
  return bands.map((value) =>
    typeof value === "number" && Number.isFinite(value) ? clampBandGain(value) : 0,
  );
}

export const useEqualizerStore = create<EqualizerState>()(
  persist(
    (set) => ({
      bypassed: false,
      bands: [...DEFAULT_BANDS],
      preampDb: 0,
      bassBoostPct: 0,
      preset: "flat",

      setBypassed: (bypassed) => set({ bypassed }),
      setBand: (index, gain) =>
        set((state) => {
          if (index < 0 || index >= state.bands.length) return state;
          const bands = [...state.bands];
          bands[index] = clampBandGain(gain);
          return { bands, preset: detectPresetId(bands) };
        }),
      setPreamp: (db) => {
        const clamped = Math.max(-12, Math.min(12, Number.isFinite(db) ? db : 0));
        set({ preampDb: clamped });
      },
      setBassBoost: (pct) => {
        const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
        set({ bassBoostPct: clamped });
      },
      applyPreset: (preset) =>
        set({
          preset,
          bands: [...EQ_PRESET_BANDS[preset]],
        }),
      resetFlat: () =>
        set({ preset: "flat", bands: [...EQ_PRESET_BANDS.flat] }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        bypassed: state.bypassed,
        bands: state.bands,
        preampDb: state.preampDb,
        bassBoostPct: state.bassBoostPct,
        preset: state.preset,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<EqualizerState>;
        const bands = sanitizeBands(p.bands);
        return {
          ...current,
          bypassed: typeof p.bypassed === "boolean" ? p.bypassed : false,
          bands,
          preampDb:
            typeof p.preampDb === "number" && Number.isFinite(p.preampDb)
              ? Math.max(-12, Math.min(12, p.preampDb))
              : 0,
          bassBoostPct:
            typeof p.bassBoostPct === "number" && Number.isFinite(p.bassBoostPct)
              ? Math.max(0, Math.min(100, p.bassBoostPct))
              : 0,
          preset: detectPresetId(bands),
        };
      },
    },
  ),
);
