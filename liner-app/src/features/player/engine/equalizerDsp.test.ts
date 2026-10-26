import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  applyEqualizerParams,
  buildEqChain,
  clampDb,
  dbToGain,
  EQ_BAND_FREQUENCIES,
} from "./equalizerDsp";

/** typed accessor for the recorded setTargetAtTime calls on a mocked param */
type MockParam = AudioParam & {
  calls: { value: number; time: number; tc: number }[];
};
const callsOf = (param: AudioParam): MockParam["calls"] =>
  (param as MockParam).calls;

/** minimal AudioParam stand-in capturing setTargetAtTime calls */
function makeParam(initial = 1) {
  const calls: { value: number; time: number; tc: number }[] = [];
  return {
    value: initial,
    setTargetAtTime: (value: number, time: number, tc: number) => {
      calls.push({ value, time, tc });
    },
    calls,
  };
}

function makeCtx() {
  const node = (extra: Record<string, unknown> = {}) => ({
    gain: makeParam(),
    frequency: makeParam(),
    Q: makeParam(),
    type: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    ...extra,
  });
  return {
    currentTime: 12.5,
    createGain: () => node(),
    createBiquadFilter: () => node(),
  } as unknown as AudioContext;
}

describe("equalizerDsp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes the 10 standard graphic-EQ band frequencies", () => {
    expect(EQ_BAND_FREQUENCIES).toHaveLength(10);
    expect(EQ_BAND_FREQUENCIES[0]).toBe(32);
    expect(EQ_BAND_FREQUENCIES[9]).toBe(16000);
  });

  it("converts dB to linear gain correctly", () => {
    expect(dbToGain(0)).toBeCloseTo(1, 10);
    expect(dbToGain(12)).toBeCloseTo(3.98, 2);
    expect(dbToGain(-12)).toBeCloseTo(0.251, 3);
  });

  it("clamps band gains to ±12dB and sanitizes junk", () => {
    expect(clampDb(15)).toBe(12);
    expect(clampDb(-99)).toBe(-12);
    expect(clampDb(Number.NaN)).toBe(0);
    expect(clampDb(3.7)).toBeCloseTo(3.7);
  });

  it("builds a 10-band chain wired wet (preamp→bass→bands) and dry", () => {
    const ctx = makeCtx();
    const chain = buildEqChain(ctx);
    expect(chain.eqBands).toHaveLength(10);
    // bands are peaking filters at the standard frequencies
    for (let i = 0; i < 10; i++) {
      expect(chain.eqBands[i].type).toBe("peaking");
    }
    // dry path wired, wet path wired through the band chain
    expect(chain.eqDryGain.connect).toHaveBeenCalledWith(chain.eqOutputGain);
    expect(chain.eqWetGain.connect).toHaveBeenCalledWith(chain.eqPreampGain);
    expect(chain.eqPreampGain.connect).toHaveBeenCalledWith(chain.eqBassShelf);
    expect(chain.eqBands[9].connect).toHaveBeenCalledWith(chain.eqOutputGain);
    // starts transparent + bypassed
    expect(chain.eqDryGain.gain.value).toBe(1);
    expect(chain.eqWetGain.gain.value).toBe(0);
  });

  it("applyEqualizerParams crossfades to wet when enabled and ramps gains", () => {
    const ctx = makeCtx();
    const chain = buildEqChain(ctx);
    applyEqualizerParams(
      chain,
      {
        bypassed: false,
        bands: [6, 0, 0, 0, 0, 0, 0, 0, 0, -6],
        preampDb: -1.5,
        bassBoostPct: 50,
      },
      5,
    );
    expect(callsOf(chain.eqDryGain.gain)[0].value).toBe(0);
    expect(callsOf(chain.eqWetGain.gain)[0].value).toBe(1);
    // 50% bass boost = +6dB on the low-shelf (BiquadFilterNode gain is in dB)
    expect(callsOf(chain.eqBassShelf.gain)[0].value).toBeCloseTo(6, 5);
    // band 0 set to +6dB (BiquadFilterNode gain is in dB)
    expect(callsOf(chain.eqBands[0].gain)[0].value).toBeCloseTo(6, 5);
    // band 9 set to -6dB
    expect(callsOf(chain.eqBands[9].gain)[0].value).toBeCloseTo(-6, 5);
    // preamp -1.5dB
    expect(callsOf(chain.eqPreampGain.gain)[0].value).toBeCloseTo(dbToGain(-1.5), 5);
    // uses the provided context time
    expect(callsOf(chain.eqBands[0].gain)[0].time).toBe(5);
  });

  it("applyEqualizerParams bypasses without touching filter values", () => {
    const ctx = makeCtx();
    const chain = buildEqChain(ctx);
    applyEqualizerParams(chain, { bypassed: true }, 0);
    expect(callsOf(chain.eqDryGain.gain)[0].value).toBe(1);
    expect(callsOf(chain.eqWetGain.gain)[0].value).toBe(0);
    expect(callsOf(chain.eqBands[0].gain)).toHaveLength(0);
    expect(callsOf(chain.eqPreampGain.gain)).toHaveLength(0);
  });
});
