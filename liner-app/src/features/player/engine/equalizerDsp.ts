/**
 * 10-band graphic equalizer DSP stage for the shared Web Audio effects graph.
 *
 * Signal flow (inside the graph built by pitchShifter.ts):
 *
 *   input ──→ eqDryGain ────────────────────────────────────┐
 *            └─→ eqWetGain → preamp → bassShelf → 10 bands ─┴─→ output
 *
 * - Bands are peaking BiquadFilters at standard graphic-EQ frequencies
 *   (32Hz … 16kHz), ±12 dB, so "all zeros" is bit-transparent.
 * - Bass Boost is a separate low-shelf (0–100% maps to 0…+12 dB @ 150Hz)
 *   so it stacks on top of any preset like on the desktop app. The shelf sits
 *   at 150Hz (not lower) because most laptop/phone/TV speakers cannot
 *   reproduce content below ~100Hz at all — a 90Hz shelf measurably boosts
 *   the signal yet stays inaudible on such setups, which reads as "bass
 *   boost isn't working". 150Hz lands the boost where speakers actually
 *   have output (and still fully covers sub-bass, since a low-shelf lifts
 *   everything below its corner).
 * - Master Preamp compensates for EQ gain stacking (±12 dB, 0 = unity).
 * - Bypass is a parallel dry/wet crossfade (20ms) instead of rewiring, so
 *   toggling never clicks and the graph topology never changes at runtime.
 */

export const EQ_BAND_FREQUENCIES: readonly number[] = [
  32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
];

export const EQ_MAX_GAIN_DB = 12;
export const EQ_DEFAULT_Q = 1.1;
export const BASS_SHELF_FREQUENCY = 150;
export const BASS_BOOST_MAX_DB = 12;

export interface EqualizerParams {
  bypassed?: boolean;
  /** 10 band gains in dB, -12..+12 */
  bands?: number[];
  /** master preamp in dB, -12..+12 */
  preampDb?: number;
  /** bass boost amount, 0..100 */
  bassBoostPct?: number;
}

export interface EqChainNodes {
  eqDryGain: GainNode;
  eqWetGain: GainNode;
  eqPreampGain: GainNode;
  eqBassShelf: BiquadFilterNode;
  eqBands: BiquadFilterNode[];
  eqOutputGain: GainNode;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function clampDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-EQ_MAX_GAIN_DB, Math.min(EQ_MAX_GAIN_DB, value));
}

export function buildEqChain(ctx: AudioContext): EqChainNodes {
  const eqDryGain = ctx.createGain();
  const eqWetGain = ctx.createGain();
  const eqPreampGain = ctx.createGain();
  const eqOutputGain = ctx.createGain();

  // bit-transparent defaults: bypassed until the store says otherwise
  eqDryGain.gain.value = 1;
  eqWetGain.gain.value = 0;
  eqPreampGain.gain.value = 1;
  eqOutputGain.gain.value = 1;

  const eqBassShelf = ctx.createBiquadFilter();
  eqBassShelf.type = "lowshelf";
  eqBassShelf.frequency.value = BASS_SHELF_FREQUENCY;
  eqBassShelf.gain.value = 0;

  const eqBands: BiquadFilterNode[] = EQ_BAND_FREQUENCIES.map((freq) => {
    const filter = ctx.createBiquadFilter();
    filter.type = "peaking";
    filter.frequency.value = freq;
    filter.Q.value = EQ_DEFAULT_Q;
    filter.gain.value = 0;
    return filter;
  });

  // wet path: preamp → bass shelf → band 0 → … → band 9
  eqWetGain.connect(eqPreampGain);
  eqPreampGain.connect(eqBassShelf);
  let cursor: AudioNode = eqBassShelf;
  for (const band of eqBands) {
    cursor.connect(band);
    cursor = band;
  }
  cursor.connect(eqOutputGain);

  // dry path
  eqDryGain.connect(eqOutputGain);

  return { eqDryGain, eqWetGain, eqPreampGain, eqBassShelf, eqBands, eqOutputGain };
}

/**
 * Applies equalizer params to the chain with click-free ramps.
 * Safe to call on every store change; only touched params are re-ramped.
 */
export function applyEqualizerParams(
  nodes: EqChainNodes,
  params: EqualizerParams,
  contextTime?: number,
): void {
  const now =
    contextTime ??
    (typeof nodes.eqDryGain.context.currentTime === "number"
      ? nodes.eqDryGain.context.currentTime
      : 0);
  const smooth = (param: AudioParam, value: number) => {
    param.setTargetAtTime(value, now, 0.02);
  };

  const bypassed = params.bypassed ?? false;
  smooth(nodes.eqDryGain.gain, bypassed ? 1 : 0);
  smooth(nodes.eqWetGain.gain, bypassed ? 0 : 1);

  if (bypassed) return; // leave filter values as-is; dry path is serving audio

  const preampDb = clampDb(params.preampDb ?? 0);
  smooth(nodes.eqPreampGain.gain, dbToGain(preampDb));

  const bassPct = Math.max(0, Math.min(100, params.bassBoostPct ?? 0));
  smooth(
    nodes.eqBassShelf.gain,
    (bassPct / 100) * BASS_BOOST_MAX_DB,
  );

  if (params.bands) {
    for (let i = 0; i < nodes.eqBands.length; i++) {
      const value = params.bands[i];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      smooth(nodes.eqBands[i].gain, clampDb(value));
    }
  }
}
