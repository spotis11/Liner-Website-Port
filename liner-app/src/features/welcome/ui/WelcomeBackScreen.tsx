// Post-SIGN-IN welcome: a single warm greeting screen.
// Deliberately different from the sign-up onboarding wizard — this is just
// "welcome back, ready to dive in?" with one CTA, per product request.

import { useTranslation } from "@/languages";
import { WelcomeShell, WelcomeBrandRow } from "./WelcomeShell";
import { useWelcomeStore } from "../store/welcomeStore";

export function WelcomeBackScreen({ displayName }: { displayName: string }) {
  const { t } = useTranslation();
  const complete = useWelcomeStore((s) => s.complete);

  return (
    <WelcomeShell mood="neutral" label={t("welcome.signin_title", { name: displayName })}>
      <div
        className="welcome-card relative w-[min(430px,100%)] overflow-hidden rounded-[26px] border border-white/[0.09] px-[36px] py-[38px] text-center shadow-[0_40px_120px_-24px_rgba(0,0,0,0.7)] backdrop-blur-2xl"
        style={{
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.075), rgba(255,255,255,0.04))",
        }}
      >
        {/* top hairline highlight, same glass treatment as the ban wall */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-[26px] top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent"
        />

        <WelcomeBrandRow />

        <h1 className="mt-[22px] text-[26px] font-extrabold leading-tight text-white">
          {t("welcome.signin_title", { name: displayName })}
        </h1>

        <p className="mt-[10px] text-[14.5px] leading-relaxed text-white/70">
          {t("welcome.signin_body")}
        </p>

        <p className="mt-[18px] text-[15px] font-semibold text-white/90">
          {t("welcome.signin_tagline")}
        </p>

        <button
          type="button"
          onClick={complete}
          className="mt-[26px] h-[48px] w-full cursor-pointer rounded-[16px] bg-white text-[15px] font-semibold text-[#101010] shadow-[0_14px_34px_-14px_rgba(255,255,255,0.35)] transition-all hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          {t("welcome.signin_cta")}
        </button>
      </div>
    </WelcomeShell>
  );
}
