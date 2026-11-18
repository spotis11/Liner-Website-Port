/**
 * Sound wave visualizer engine.
 *
 * Taps an AnalyserNode onto the shared Web Audio effects graph (the same
 * masterOutputGain bus the equalizer / pitch / reverb stages feed), so the
 * drawn bars are the REAL post-effects output of the music — genuinely synced
 * to playback, not a fake animation.
 *
 * The effects graph owns the one MediaElementAudioSourceNode allowed per
 * <audio> element, so we must attach through pitchShifter (idempotent) rather
 * than creating our own source: a second createMediaElementSource call would
 * throw / break playback. An AnalyserNode is a parallel tap — it never
 * consumes or alters the signal on the way to ctx.destination.
 */

import { pitchShifter } from "./pitchShifter";

let analyser: AnalyserNode | null = null;
let tapSource: AudioNode | null = null;

export function findLinerAudioElement(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  const win = window as any;
  if (win.__liner_audio) return win.__liner_audio as HTMLAudioElement;
  if (typeof document === "undefined") return null;
  return (document.getElementById("liner-audio") as HTMLAudioElement | null) ?? null;
}

/**
 * Guarantees the effects graph is attached and returns the analyser to read
 * frequency data from, or null when Web Audio is unavailable (tests, very old
 * browsers). Re-taps automatically if the graph is ever rebuilt.
 */
export function ensureSoundWaveAnalyser(
  audio: HTMLAudioElement,
): AnalyserNode | null {
  try {
    if (!pitchShifter.isAttached()) {
      pitchShifter.attach(audio);
    }
    const graph = pitchShifter.getGraph();
    if (!graph) return null;
    pitchShifter.resumeContext();

    if (!analyser) {
      analyser = graph.ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      analyser.minDecibels = -85;
      analyser.maxDecibels = -12;
    }

    if (tapSource !== graph.masterOutputGain) {
      if (tapSource) {
        try {
          tapSource.disconnect(analyser);
        } catch {
          // stale node from a rebuilt graph — nothing to undo
        }
      }
      graph.masterOutputGain.connect(analyser);
      tapSource = graph.masterOutputGain;
    }

    return analyser;
  } catch {
    return null;
  }
}
