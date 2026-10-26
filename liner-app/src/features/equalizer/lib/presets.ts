/**
 * Preset band curves for the 10-band equalizer.
 * Bands follow EQ_BAND_FREQUENCIES: 32, 64, 125, 250, 500, 1k, 2k, 4k, 8k, 16k (Hz).
 * Values are dB gains in the -12..+12 range.
 */
import { EQ_MAX_GAIN_DB } from "@/features/player/engine/equalizerDsp";

export type EqPresetId =
  | "flat"
  | "bass_boost"
  | "treble_boost"
  | "vocal"
  | "rock"
  | "pop"
  | "jazz"
  | "classical"
  | "electronic"
  | "custom";

export const EQ_PRESET_ORDER: Exclude<EqPresetId, "custom">[] = [
  "flat",
  "bass_boost",
  "treble_boost",
  "vocal",
  "rock",
  "pop",
  "jazz",
  "classical",
  "electronic",
];

export const EQ_PRESET_BANDS: Record<Exclude<EqPresetId, "custom">, number[]> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass_boost: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
  treble_boost: [0, 0, 0, 0, 0, 1, 3, 5, 6, 7],
  vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  rock: [5, 4, 2, 0, -1, 0, 2, 4, 5, 5],
  pop: [-1, 1, 3, 4, 3, 1, 0, -1, -1, -1],
  jazz: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
  classical: [4, 3, 2, 0, 0, 0, 0, 2, 3, 4],
  electronic: [6, 5, 2, 0, -2, 1, 2, 4, 5, 6],
};

export const EQ_PRESET_I18N_KEYS: Record<EqPresetId, string> = {
  flat: "player.equalizer.preset_flat",
  bass_boost: "player.equalizer.preset_bass",
  treble_boost: "player.equalizer.preset_treble",
  vocal: "player.equalizer.preset_vocal",
  rock: "player.equalizer.preset_rock",
  pop: "player.equalizer.preset_pop",
  jazz: "player.equalizer.preset_jazz",
  classical: "player.equalizer.preset_classical",
  electronic: "player.equalizer.preset_electronic",
  custom: "player.equalizer.preset_custom",
};

export function clampBandGain(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-EQ_MAX_GAIN_DB, Math.min(EQ_MAX_GAIN_DB, value));
}

/** matches a bands array against a known preset (within rounding noise) */
export function detectPresetId(bands: number[]): EqPresetId {
  for (const id of EQ_PRESET_ORDER) {
    const preset = EQ_PRESET_BANDS[id];
    if (preset.every((gain, i) => Math.abs(gain - (bands[i] ?? 0)) < 0.05)) {
      return id;
    }
  }
  return "custom";
}
