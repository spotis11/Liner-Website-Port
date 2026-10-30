// Liner web port: the desktop build renders a minimize / maximize / close
// capsule because it owns its own OS window. On the website the browser
// provides all window chrome, so the controls are intentionally not rendered —
// the component is kept as a no-op so every call site stays untouched.

export interface WindowControlsProps {
  className?: string;
  variant?: "default" | "glass" | "island";
  style?: React.CSSProperties;
  isFullscreen?: boolean;
  embedded?: boolean;
  bare?: boolean;
}

export default function WindowControls(_props: WindowControlsProps) {
  return null;
}
