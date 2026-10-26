import { useCallback, useRef } from "react";
import { cn } from "@/shared/lib";

export interface BandSliderProps {
  /** frequency label, e.g. "32" */
  label: string;
  /** unit label under the frequency, e.g. "Hz" or "kHz" */
  unit: string;
  /** gain in dB, -12..+12 */
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  /** double-click resets to this value (0dB) */
  resetValue?: number;
  disabled?: boolean;
  className?: string;
}

const PIXELS_PER_DB = 2.2; // drag sensitivity for pointer moves

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Vertical EQ band slider (±12dB, 0dB centered) matching the desktop app's
 * graphic-EQ look: slim groove, red pill thumb, pointer drag + keyboard +
 * double-click reset.
 */
export function BandSlider({
  label,
  unit,
  value,
  min = -12,
  max = 12,
  onChange,
  resetValue = 0,
  disabled = false,
  className,
}: BandSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ startValue: number; startY: number } | null>(
    null,
  );

  const range = max - min || 1;
  // +max sits at the top, -max at the bottom
  const topPct = clamp(((max - value) / range) * 100, 0, 100);

  const valueFromPointer = useCallback(
    (clientY: number) => {
      const track = trackRef.current;
      if (!track) return null;
      const rect = track.getBoundingClientRect();
      const ratio = clamp((clientY - rect.top) / rect.height, 0, 1);
      return clamp(max - ratio * range, min, max);
    },
    [max, min, range],
  );

  const round = useCallback(
    (value: number) => Math.round(value * 2) / 2, // 0.5 dB steps
    [],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragStateRef.current = { startValue: value, startY: e.clientY };
    const next = valueFromPointer(e.clientY);
    if (next !== null) onChange(round(next));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !dragStateRef.current) return;
    const next = valueFromPointer(e.clientY);
    if (next !== null) onChange(round(next));
  };

  const endDrag = () => {
    dragStateRef.current = null;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = e.shiftKey ? 3 : 1;
    let next: number | null = null;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") next = value + step;
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = value - step;
    else if (e.key === "Home") next = max;
    else if (e.key === "End") next = min;
    else if (e.key === "Delete" || e.key === "Backspace") next = resetValue;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(clamp(Math.round(next), min, max));
  };

  const thumbOffsetPct = Math.abs(value - resetValue) / range;

  return (
    <div className={cn("flex flex-col items-center gap-[6px]", className)}>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${label} ${unit}`}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(value * 10) / 10}
        aria-valuetext={`${value > 0 ? "+" : ""}${value.toFixed(1)} dB`}
        aria-orientation="vertical"
        data-eq-band={label}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onDoubleClick={() => !disabled && onChange(resetValue)}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative h-full w-[26px] cursor-ns-resize touch-none select-none outline-none",
          "group",
          disabled && "cursor-default opacity-50",
        )}
      >
        {/* groove */}
        <div className="absolute top-0 bottom-0 left-1/2 w-[4px] -translate-x-1/2 rounded-full bg-black/25 dark:bg-white/[0.09]" />
        {/* filled segment from the 0dB center to the thumb */}
        <div
          aria-hidden="true"
          className="absolute left-1/2 w-[4px] -translate-x-1/2 rounded-full bg-[#e05545]/45"
          style={
            value >= resetValue
              ? {
                  bottom: "50%",
                  height: `${thumbOffsetPct * 50}%`,
                }
              : {
                  top: "50%",
                  height: `${thumbOffsetPct * 50}%`,
                }
          }
        />
        {/* thumb */}
        <div
          className={cn(
            "absolute left-1/2 h-[7px] w-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full",
            "bg-[#e05545] shadow-[0_1px_4px_rgba(0,0,0,0.4)] transition-transform",
            "group-hover:scale-x-105 group-focus-visible:ring-2 group-focus-visible:ring-[#e05545]/60",
          )}
          style={{ top: `${topPct}%` }}
        />
      </div>
      <div className="flex flex-col items-center leading-none select-none">
        <span
          className={cn(
            "text-[11px] font-[600] tabular-nums",
            value !== 0 ? "text-text-primary" : "text-text-tertiary",
          )}
        >
          {label}
        </span>
        <span className="mt-[1px] text-[9px] text-text-tertiary">{unit}</span>
      </div>
    </div>
  );
}
