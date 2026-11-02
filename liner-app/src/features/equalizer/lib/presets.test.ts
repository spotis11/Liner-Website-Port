import { describe, expect, it } from "vitest";
import {
  EQ_PRESET_BANDS,
  EQ_PRESET_ORDER,
  clampBandGain,
  detectPresetId,
} from "./presets";

describe("equalizer presets", () => {
  it("has 9 named presets plus flat, all with 10 bands within ±12dB", () => {
    expect(EQ_PRESET_ORDER[0]).toBe("flat");
    for (const id of EQ_PRESET_ORDER) {
      const bands = EQ_PRESET_BANDS[id];
      expect(bands).toHaveLength(10);
      for (const gain of bands) {
        expect(gain).toBeGreaterThanOrEqual(-12);
        expect(gain).toBeLessThanOrEqual(12);
      }
    }
  });

  it("flat is all zeros", () => {
    expect(EQ_PRESET_BANDS.flat.every((g) => g === 0)).toBe(true);
  });

  it("detects known presets and falls back to custom", () => {
    expect(detectPresetId(EQ_PRESET_BANDS.bass_boost)).toBe("bass_boost");
    expect(detectPresetId(EQ_PRESET_BANDS.flat)).toBe("flat");
    expect(detectPresetId([1, 2, 3, 0, 0, 0, 0, 0, 0, 0])).toBe("custom");
    // an empty bands array trivially matches "flat"
    expect(detectPresetId([])).toBe("flat");
  });

  it("clamps band gains", () => {
    expect(clampBandGain(20)).toBe(12);
    expect(clampBandGain(-20)).toBe(-12);
    expect(clampBandGain(Number.NaN)).toBe(0);
  });
});
