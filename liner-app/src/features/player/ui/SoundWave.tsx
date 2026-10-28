import { useEffect, useRef } from "react";
import { usePlayerStore } from "../store/playerStore";
import {
  ensureSoundWaveAnalyser,
  findLinerAudioElement,
} from "../engine/soundWave";

const BAR_COUNT = 64;
/** log-spaced band edges: 40 Hz .. ~15 kHz so music spreads across all bars
    instead of piling into the first few (linear) bass bins */
const F_MIN = 40;
const F_MAX = 15000;
const IDLE_DECAY = 0.9;
/** time-domain resolution for the glowing waveform line */
const WAVE_POINTS = 96;
/** ambient ribbons drawn behind the bars (aurora layers) — see RIBBONS */

/** aurora palette — cyan -> blue -> violet -> fuchsia -> pink (Apple Music-ish) */
const GRADIENT_STOPS: Array<[number, string]> = [
  [0.0, "#22d3ee"],
  [0.26, "#60a5fa"],
  [0.5, "#a78bfa"],
  [0.75, "#e879f9"],
  [1.0, "#f472b6"],
];
interface RibbonConfig {
  color: string;
  mode: "fill" | "stroke";
  alpha: number;
  lineWidth?: number;
}
const RIBBONS: RibbonConfig[] = [
  { color: "34, 211, 238", mode: "fill", alpha: 0.16 }, // cyan bass bed
  { color: "129, 140, 248", mode: "fill", alpha: 0.11 }, // indigo mid bed
  { color: "244, 114, 182", mode: "stroke", alpha: 0.4, lineWidth: 1.6 }, // pink crest
];

interface SoundWaveProps {
  className?: string;
}

/**
 * Canvas sound wave for the fullscreen player — an aurora-style visualizer
 * fed by a live AnalyserNode, so everything moves exactly with the music
 * (and with any pitch / reverb / EQ effects applied to it):
 *   1. three soft gradient ribbons breathing behind everything (depth)
 *   2. mirrored frequency bars in a flowing cyan->pink gradient (the wave)
 *   3. a glowing time-domain waveform line tracing the actual signal
 * Renders nothing until a real analyser is available; never fakes motion —
 * when the music stops the layers decay and the canvas fades to near-zero.
 */
export function SoundWave({ className }: SoundWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const audio = findLinerAudioElement();
    if (!audio) return;
    const analyser = ensureSoundWaveAnalyser(audio);
    if (!analyser) return;

    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let barGradient: CanvasGradient | null = null;
    let gradientWidth = 0;
    const getBarGradient = (width: number) => {
      if (!barGradient || gradientWidth !== width) {
        barGradient = ctx2d.createLinearGradient(0, 0, width, 0);
        for (const [pos, color] of GRADIENT_STOPS) {
          barGradient.addColorStop(pos, color);
        }
        gradientWidth = width;
      }
      return barGradient;
    };

    const resize = () => {
      const width = canvas.clientWidth || canvas.parentElement?.clientWidth || 0;
      const height = canvas.clientHeight || canvas.parentElement?.clientHeight || 0;
      if (width === 0 || height === 0) return;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      gradientWidth = 0; // rebuild gradient for the new size
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // keep the AudioContext alive (autoplay policy) while the wave is shown
    const resume = () => {
      try {
        (window as any).__liner_audio_context?.resume?.();
      } catch {
        // ignore — resume() on a running context is a no-op
      }
    };
    audio.addEventListener("play", resume);
    audio.addEventListener("playing", resume);

    const spectrum = new Uint8Array(analyser.frequencyBinCount);
    const timeDomain = new Uint8Array(analyser.fftSize);
    const levels = new Float32Array(BAR_COUNT);
    const rawLevels = new Float32Array(BAR_COUNT);
    const scratch = new Float32Array(BAR_COUNT);
    // precompute log-spaced band edges in FFT-bin units (bin width = nyquist /
    // frequencyBinCount; an edge of f Hz lands at f / nyquist * binCount)
    const nyquist = analyser.context.sampleRate / 2;
    const bandTop = Math.min(F_MAX, nyquist * 0.95);
    const edges = new Float64Array(BAR_COUNT + 1);
    for (let i = 0; i <= BAR_COUNT; i++) {
      const f = F_MIN * Math.pow(bandTop / F_MIN, i / BAR_COUNT);
      edges[i] = Math.min(spectrum.length - 1, (f / nyquist) * spectrum.length);
    }
    let rafId = 0;
    let running = true;
    let dim = 0; // 0 = hidden (paused), 1 = fully lit (playing) — eased
    let phase = 0;

    const draw = () => {
      if (!running) return;
      rafId = requestAnimationFrame(draw);

      const width = canvas.width;
      const height = canvas.height;
      if (width === 0 || height === 0) return;

      analyser.getByteFrequencyData(spectrum);
      analyser.getByteTimeDomainData(timeDomain);

      // ease the whole scene toward lit-while-playing / dim-while-paused
      const playing = !audio.paused;
      dim += ((playing ? 1 : 0.06) - dim) * 0.08;

      ctx2d.clearRect(0, 0, width, height);
      if (dim < 0.015) return;

      phase += 0.011 + dim * 0.008;

      // ---- band energies for the ambient ribbons (bass / mid / treble) ----
      const third = Math.floor(BAR_COUNT / 3);

      // ---- 1. raw bar levels from log-spaced bands ----
      for (let i = 0; i < BAR_COUNT; i++) {
        const start = Math.floor(edges[i]);
        const end = Math.max(start + 1, Math.floor(edges[i + 1]));
        let sum = 0;
        let peak = 0;
        let count = 0;
        for (let b = start; b < end && b < spectrum.length; b++) {
          sum += spectrum[b];
          if (spectrum[b] > peak) peak = spectrum[b];
          count++;
        }
        if (count === 0) {
          sum = spectrum[start] ?? 0;
          peak = sum;
          count = 1;
        }
        // blend mean + peak: pure averaging dilutes wide treble bands into
        // invisibility, pure peak makes the whole row jitter
        const average = ((sum / count) * 0.55 + peak * 0.45) / 255;
        const tilted = Math.min(1, average * (1 + (i / BAR_COUNT) * 0.9));
        rawLevels[i] = Math.pow(tilted, 0.82);
      }

      // ---- spatial smoothing: neighbor blur so heights flow as one wave ----
      for (let pass = 0; pass < 2; pass++) {
        scratch.set(rawLevels);
        for (let i = 0; i < BAR_COUNT; i++) {
          const l = scratch[Math.max(0, i - 1)];
          const r = scratch[Math.min(BAR_COUNT - 1, i + 1)];
          rawLevels[i] = scratch[i] * 0.6 + l * 0.2 + r * 0.2;
        }
      }

      // ---- temporal envelope per bar (fast attack, smooth decay) ----
      for (let i = 0; i < BAR_COUNT; i++) {
        if (rawLevels[i] > levels[i]) {
          levels[i] += (rawLevels[i] - levels[i]) * 0.55;
        } else {
          levels[i] = Math.max(rawLevels[i], levels[i] * IDLE_DECAY);
        }
      }

      // band energies AFTER smoothing so ribbons track what is visible
      let bass = 0;
      let midEnergy = 0;
      let treble = 0;
      for (let i = 0; i < BAR_COUNT; i++) {
        if (i < third) bass = Math.max(bass, levels[i]);
        else if (i < third * 2) midEnergy = Math.max(midEnergy, levels[i]);
        else treble = Math.max(treble, levels[i]);
      }
      const amplitude = (bass + midEnergy * 0.8 + treble * 0.6) / 2.4;

      const mid = height / 2;
      const unit = Math.min(dpr, 2);

      // ---- 2. ambient ribbons (additive, behind everything) ----
      // filled beds fade VERTICALLY so they never become a fog wall; the
      // crest ribbon is a stroked highlight tracing the top of the cluster
      ctx2d.save();
      ctx2d.globalCompositeOperation = "lighter";
      for (let r = 0; r < RIBBONS.length; r++) {
        const cfg = RIBBONS[r];
        const bandEnergy = [bass, midEnergy, treble][r];
        const amp = height * (0.05 + 0.3 * bandEnergy) * (1 - r * 0.18);
        const yBias = mid + (r - 1) * height * 0.06;
        const freq = 1.6 + r * 0.9;
        const drift = phase * (0.7 + r * 0.35);
        ctx2d.beginPath();
        if (cfg.mode === "fill") ctx2d.moveTo(0, height);
        for (let x = 0; x <= width; x += 8 * unit) {
          const t = x / width;
          const envelope = Math.sin(t * Math.PI); // fade at both edges
          const y =
            yBias +
            Math.sin(t * Math.PI * freq + drift) * amp * envelope +
            Math.sin(t * Math.PI * freq * 2.3 + drift * 1.7) *
              amp *
              0.35 *
              envelope;
          ctx2d.lineTo(x, y);
        }
        if (cfg.mode === "fill") {
          ctx2d.lineTo(width, height);
          ctx2d.closePath();
          // vertical fade: color at the resting crest, gone by the bottom
          const fade = ctx2d.createLinearGradient(0, yBias - amp, 0, height);
          fade.addColorStop(0, `rgba(${cfg.color}, ${cfg.alpha * dim})`);
          fade.addColorStop(1, `rgba(${cfg.color}, 0)`);
          ctx2d.fillStyle = fade;
          ctx2d.fill();
        } else {
          ctx2d.lineJoin = "round";
          ctx2d.lineCap = "round";
          ctx2d.lineWidth = (cfg.lineWidth ?? 1.5) * unit;
          ctx2d.strokeStyle = `rgba(${cfg.color}, ${cfg.alpha * dim})`;
          ctx2d.stroke();
        }
      }
      ctx2d.restore();

      // ---- 3. mirrored frequency bars (the main wave) ----
      const gap = Math.max(1, (width / BAR_COUNT) * 0.24);
      const barWidth = Math.max(1, width / BAR_COUNT - gap);
      const radius = Math.min(barWidth / 2, 2 * unit);
      const gradient = getBarGradient(width);
      ctx2d.fillStyle = gradient;
      for (let i = 0; i < BAR_COUNT; i++) {
        // horizontal edge taper: first/last ~15% of bars fade out
        const t = i / (BAR_COUNT - 1);
        const edge =
          t < 0.15
            ? 0.35 + (t / 0.15) * 0.65
            : t > 0.85
              ? 0.35 + ((1 - t) / 0.15) * 0.65
              : 1;
        const barHeight = Math.max(
          height * 0.012 * dim,
          levels[i] * height * 0.92 * edge,
        );
        const x = i * (barWidth + gap);
        ctx2d.globalAlpha = (0.32 + levels[i] * 0.68) * dim;
        ctx2d.beginPath();
        ctx2d.roundRect(x, mid - barHeight / 2, barWidth, barHeight, radius);
        ctx2d.fill();
      }
      ctx2d.globalAlpha = 1;

      // bright caps on lively bars — a subtle sparkle layer
      ctx2d.save();
      ctx2d.globalCompositeOperation = "lighter";
      ctx2d.fillStyle = "#ffffff";
      for (let i = 0; i < BAR_COUNT; i++) {
        if (levels[i] < 0.42) continue;
        const t = i / (BAR_COUNT - 1);
        const edge =
          t < 0.15
            ? (t / 0.15) * 0.8
            : t > 0.85
              ? ((1 - t) / 0.15) * 0.8
              : 0.8;
        const barHeight = Math.max(
          height * 0.012 * dim,
          levels[i] * height * 0.92 * edge,
        );
        const x = i * (barWidth + gap);
        ctx2d.globalAlpha = (levels[i] - 0.42) * 1.1 * dim * edge;
        ctx2d.beginPath();
        ctx2d.roundRect(
          x,
          mid - barHeight / 2,
          barWidth,
          Math.max(1.5 * unit, barHeight * 0.12),
          radius,
        );
        ctx2d.fill();
        ctx2d.beginPath();
        ctx2d.roundRect(
          x,
          mid + barHeight / 2 - Math.max(1.5 * unit, barHeight * 0.12),
          barWidth,
          Math.max(1.5 * unit, barHeight * 0.12),
          radius,
        );
        ctx2d.fill();
      }
      ctx2d.restore();
      ctx2d.globalAlpha = 1;

      // ---- 4. glowing waveform line tracing the real signal ----
      ctx2d.save();
      ctx2d.globalCompositeOperation = "lighter";
      ctx2d.lineWidth = 1.6 * unit;
      ctx2d.lineJoin = "round";
      ctx2d.lineCap = "round";
      ctx2d.shadowColor = "rgba(125, 211, 252, 0.9)";
      ctx2d.shadowBlur = 14 * unit;
      ctx2d.strokeStyle = `rgba(255, 255, 255, ${0.5 * dim})`;
      ctx2d.beginPath();
      const usable = timeDomain.length - 1;
      for (let p = 0; p <= WAVE_POINTS; p++) {
        const t = p / WAVE_POINTS;
        // time-domain byte: 128 = zero crossing
        const v = (timeDomain[Math.floor(t * usable)] - 128) / 128;
        const envelope = Math.sin(t * Math.PI);
        const x = t * width;
        const y =
          mid + v * height * 0.3 * envelope * (0.35 + 0.65 * amplitude);
        if (p === 0) ctx2d.moveTo(x, y);
        else {
          const prevT = (p - 1) / WAVE_POINTS;
          const prevV =
            (timeDomain[Math.floor(prevT * usable)] - 128) / 128;
          const prevY =
            mid +
            prevV * height * 0.3 * envelope * (0.35 + 0.65 * amplitude);
          ctx2d.quadraticCurveTo(
            ((prevT + t) / 2) * width,
            (prevY + y) / 2,
            x,
            y,
          );
        }
      }
      ctx2d.stroke();
      ctx2d.restore();
    };

    rafId = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      observer.disconnect();
      audio.removeEventListener("play", resume);
      audio.removeEventListener("playing", resume);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      data-testid="sound-wave-canvas"
    />
  );
}

/** setting selector so callers re-render only when the toggle flips */
export function useSoundWaveEnabled(): boolean {
  return usePlayerStore((state) => state.soundWaveEnabled);
}

export default SoundWave;
