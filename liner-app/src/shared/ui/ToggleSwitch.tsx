import { useEffect, useLayoutEffect, useRef } from "react";
import type { CSSProperties } from "react";
import "@material/web/switch/switch.js";

export interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
  disabled?: boolean;
}

type MaterialSwitchElement = HTMLElement & { selected: boolean };

const switchColors = {
  "--md-switch-selected-track-color":
    "var(--m3-primary, var(--accent-primary, #6750a4))",
  "--md-switch-selected-handle-color":
    "var(--m3-on-primary, var(--btn-primary-text, #ffffff))",
  "--md-switch-handle-color": "var(--m3-outline, var(--text-tertiary, #79747e))",
  "--md-switch-track-color":
    "var(--m3-surface-container-highest, var(--bg-elevated, #e6e0e9))",
} as CSSProperties;

/** Google Material Web's M3 switch, kept controlled by the React setting state. */
export function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
}: ToggleSwitchProps) {
  const switchRef = useRef<MaterialSwitchElement | null>(null);
  const onChangeRef = useRef(onChange);

  useLayoutEffect(() => {
    if (switchRef.current) switchRef.current.selected = checked;
  }, [checked]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const element = switchRef.current;
    if (!element) return;

    const handleChange = () => onChangeRef.current(element.selected);
    element.addEventListener("change", handleChange);
    return () => element.removeEventListener("change", handleChange);
  }, []);

  return (
    <md-switch
      ref={(element: HTMLElement | null) => {
        switchRef.current = element as MaterialSwitchElement | null;
      }}
      selected={checked}
      disabled={disabled}
      aria-label={ariaLabel ?? "Toggle setting"}
      style={switchColors}
    />
  );
}

export default ToggleSwitch;
