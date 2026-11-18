import backdropMark from "@/assets/login-backdrop.svg";
import { cn } from "@/shared/lib";
import type { LoginPanelVariant } from "./LoginBrandPanel";

export interface LoginBackdropProps {
  edgeToEdge?: boolean;
  /** "original" (default) = classic glow strengths; "new" = softer evi
   * redesign glows with the backdrop mark dimmed in dark mode. */
  variant?: LoginPanelVariant;
}

export function LoginBackdrop({
  edgeToEdge = false,
  variant = "original",
}: LoginBackdropProps) {
  const isNew = variant === "new";
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-0 select-none overflow-hidden bg-login-backdrop",
        edgeToEdge ? "rounded-none" : isNew ? "rounded-[14px]" : "rounded-5xl",
      )}
    >
      <div
        className={cn(
          "absolute -left-[15%] -top-[25%] h-[70%] w-[50%] rounded-full bg-login-glow blur-[140px]",
          isNew ? "opacity-[0.1]" : "opacity-[0.22]",
        )}
      />
      <div
        className={cn(
          "absolute -right-[15%] top-[10%] h-[80%] w-[40%] rounded-full bg-login-glow-secondary blur-[140px]",
          isNew ? "opacity-[0.22]" : "opacity-[0.18]",
        )}
      />
      <div
        className={cn(
          "absolute -bottom-[35%] left-[25%] h-[60%] w-[55%] rounded-full bg-login-glow blur-[140px]",
          isNew ? "opacity-[0.08]" : "opacity-[0.2]",
        )}
      />
      <img
        src={backdropMark}
        alt=""
        aria-hidden="true"
        width={1200}
        height={780}
        draggable={false}
        className={cn(
          "absolute inset-0 h-full w-full object-cover",
          isNew && "dark:opacity-0",
        )}
      />
    </div>
  );
}

export default LoginBackdrop;
