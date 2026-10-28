// Shared full-screen shell for the welcome / onboarding flows.
// Same brand language as the login page and the banned wall: the login
// backdrop (dark in both app themes), a giant Liner glyph watermark, a soft
// glow and a dark-glass card. The glow color follows the flow mood.

import { LoginBackdrop } from "@/features/auth/ui/LoginBackdrop";
import logo from "@/assets/logo.svg";
import type { ReactNode } from "react";

const font = { fontFamily: "var(--font-inter), sans-serif" };

export function WelcomeShell({
  children,
  mood = "neutral",
  label,
}: {
  children: ReactNode;
  /** "green" = onboarding finale celebration, otherwise the calm brand glow. */
  mood?: "neutral" | "green";
  label: string;
}) {
  return (
    <div
      className="welcome-fade fixed inset-0 z-[9300] overflow-hidden bg-login-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      style={font}
    >
      {/* branded backdrop, softened so the card reads calm */}
      <div className="absolute inset-0 opacity-70">
        <LoginBackdrop edgeToEdge />
      </div>

      {/* the Liner glyph as a giant banner watermark, echoing login + ban wall */}
      <img
        src={logo}
        alt=""
        aria-hidden="true"
        width={45}
        height={35}
        draggable={false}
        className="pointer-events-none absolute left-1/2 top-1/2 h-auto w-[min(760px,120vw)] -translate-x-1/2 -translate-y-[64%] select-none mask-b-from-35% mask-b-to-92% opacity-[0.06]"
      />

      {/* soft mood glow behind the card */}
      <div
        aria-hidden
        className={`pointer-events-none absolute left-1/2 top-1/2 h-[300px] w-[520px] max-w-[94vw] -translate-x-1/2 -translate-y-[58%] rounded-full blur-[130px] ${
          mood === "green"
            ? "bg-[#34d399]/[0.17]"
            : "bg-white/[0.10]"
        }`}
      />

      <div className="relative z-10 flex min-h-full items-center justify-center overflow-y-auto px-[24px] py-[40px]">
        {children}
      </div>
    </div>
  );
}

/** Liner logo + wordmark row used at the top of every welcome card. */
export function WelcomeBrandRow({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center justify-center gap-[10px]">
      <img
        src={logo}
        alt="Liner"
        draggable={false}
        className={`${compact ? "h-[24px] w-[30px]" : "h-[34px] w-[42px]"} select-none`}
      />
      <span
        className={`bg-gradient-to-b from-white to-white/55 bg-clip-text font-bold tracking-[0.16em] text-transparent ${
          compact ? "text-[15px]" : "text-[18px]"
        }`}
        style={{ fontFamily: "Montserrat, var(--font-inter), sans-serif" }}
      >
        LINER
      </span>
    </div>
  );
}
