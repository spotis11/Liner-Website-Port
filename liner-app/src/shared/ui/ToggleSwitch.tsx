import { cn } from "@/shared/lib/utils";

export interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
  disabled?: boolean;
}

/**
 * Compact pill switch matching evi.wtf's toggle (their exact spec: 44x26
 * track, 20px thumb inset 3px, 18px travel, track color cross-fades over
 * 200ms while the thumb slides). Replaces Google's M3 md-switch.
 * Checked track uses the Liner accent so the branding stays ours.
 */
export function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
}: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        "relative inline-flex h-[26px] w-[44px] shrink-0 cursor-pointer rounded-full border-0 p-0 outline-none select-none",
        "transition-colors duration-200",
        "focus-visible:ring-2 focus-visible:ring-text-primary/25 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary",
        checked
          ? "bg-accent-primary hover:bg-accent-primary/90"
          : "bg-black/[0.12] hover:bg-black/[0.18] dark:bg-white/[0.14] dark:hover:bg-white/[0.2]",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-[3px] top-[3px] block h-5 w-5 rounded-full bg-white",
          "shadow-[0_1px_3px_rgba(0,0,0,0.35)]",
          "transition-transform duration-200 ease-out",
          checked && "translate-x-[18px]",
        )}
      />
    </button>
  );
}

export default ToggleSwitch;
