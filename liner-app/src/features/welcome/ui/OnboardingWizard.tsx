// Post-SIGN-UP onboarding: 3 steps (profile picture → 3 artists → theme)
// followed by a green "THAT'S ALL!" celebration. Deliberately different from
// the sign-in welcome: this is the "get to know you" wizard for brand-new
// accounts. Every step can be finished later in settings, per copy.

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "@/languages";
import Button from "@/shared/ui/Button";
import { useToast } from "@/shared/ui";
import { useAuthStore } from "@/features/auth";
import { WelcomeShell, WelcomeBrandRow } from "./WelcomeShell";
import {
  ArtistsStep,
  ProfilePictureStep,
  ThemeStep,
} from "./OnboardingSteps";
import {
  ONBOARDING_STEP_COUNT,
  useWelcomeStore,
} from "../store/welcomeStore";

const stepVariants = {
  initial: { opacity: 0, x: 22 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -22 },
};

export function OnboardingWizard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const active = useWelcomeStore((s) =>
    s.active?.kind === "signup" ? s.active : null,
  );
  const next = useWelcomeStore((s) => s.next);
  const back = useWelcomeStore((s) => s.back);
  const complete = useWelcomeStore((s) => s.complete);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const [savingAvatar, setSavingAvatar] = useState(false);

  if (!active) return null;

  const step = active.step;
  const isFinale = step > ONBOARDING_STEP_COUNT;
  const displayName = active.displayName || active.username;

  const handleNext = async () => {
    if (step !== 1) {
      next();
      return;
    }
    // Save the picked picture (if any) before leaving step 1. A failed save
    // must never trap the user in the wizard — the picture can be retried in
    // settings.
    const draftAvatar = active.draft.avatarUrl;
    if (draftAvatar) {
      setSavingAvatar(true);
      try {
        await updateProfile({ avatarUrl: draftAvatar });
      } catch {
        toast(t("settings.profile.save_failed"), "error");
      } finally {
        setSavingAvatar(false);
      }
    }
    next();
  };

  const stepMeta: Array<{
    label: string;
    title: string;
    subtitle: string;
  }> = [
    {
      label: t("welcome.step_of", { step: 1, total: ONBOARDING_STEP_COUNT }),
      title: t("welcome.signup_title", { name: displayName }),
      subtitle: t("welcome.signup_subtitle"),
    },
    {
      label: t("welcome.step_of", { step: 2, total: ONBOARDING_STEP_COUNT }),
      title: t("welcome.artists_title"),
      subtitle: t("welcome.artists_sub"),
    },
    {
      label: t("welcome.step_of", { step: 3, total: ONBOARDING_STEP_COUNT }),
      title: t("welcome.theme_title"),
      subtitle: "",
    },
  ];

  if (isFinale) {
    return (
      <WelcomeShell mood="green" label={t("welcome.finale_title")}>
        <FinaleCard displayName={displayName} onDone={complete} />
      </WelcomeShell>
    );
  }

  const meta = stepMeta[step - 1];

  return (
    <WelcomeShell
      mood="neutral"
      label={meta.title}
    >
      <div
        className="welcome-card relative w-[min(580px,100%)] overflow-hidden rounded-[26px] border border-white/[0.09] px-[30px] py-[28px] shadow-[0_40px_120px_-24px_rgba(0,0,0,0.7)] backdrop-blur-2xl sm:px-[38px] sm:py-[32px]"
        style={{
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.075), rgba(255,255,255,0.04))",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-[26px] top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent"
        />

        <WelcomeBrandRow compact />

        {/* step header */}
        <div key={`header-${step}`} className="mt-[18px] text-center">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-[#7ef0bd]">
            {meta.label}
          </p>
          <h1 className="mt-[6px] text-[24px] font-extrabold leading-tight text-white">
            {meta.title}
          </h1>
          {meta.subtitle ? (
            <p className="mt-[6px] text-[13.5px] leading-relaxed text-white/65">
              {meta.subtitle}
            </p>
          ) : null}
        </div>

        {/* progress segments */}
        <div className="mt-[16px] flex items-center justify-center gap-[8px]" aria-hidden>
          {Array.from({ length: ONBOARDING_STEP_COUNT }).map((_, i) => (
            <span
              key={i}
              className={`h-[4px] rounded-full transition-all duration-300 ${
                i < step
                  ? "w-[34px] bg-gradient-to-r from-[#3ddc97] to-[#17b26a]"
                  : "w-[22px] bg-white/12"
              }`}
            />
          ))}
        </div>

        {/* step body */}
        <div className="mt-[22px] min-h-[264px]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`body-${step}`}
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              {step === 1 ? <ProfilePictureStep /> : null}
              {step === 2 ? <ArtistsStep /> : null}
              {step === 3 ? <ThemeStep /> : null}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* footer controls */}
        <div className="mt-[20px] flex items-center justify-between gap-[12px]">
          <Button
            variant="ghost"
            onClick={back}
            className="cursor-pointer rounded-[14px] text-[13.5px] font-medium text-white/70 hover:text-white"
          >
            {t("welcome.back")}
          </Button>

          {step < ONBOARDING_STEP_COUNT ? (
            <Button
              onClick={() => void handleNext()}
              disabled={savingAvatar}
              size="lg"
              className="min-w-[128px] cursor-pointer rounded-[16px] text-[14.5px] font-semibold"
            >
              {savingAvatar ? "…" : t("welcome.next")}
            </Button>
          ) : (
            <button
              type="button"
              onClick={() => void handleNext()}
              disabled={savingAvatar}
              className="min-w-[128px] cursor-pointer rounded-[16px] bg-gradient-to-b from-[#3ddc97] to-[#17b26a] px-[24px] py-[12px] text-[14.5px] font-bold text-[#06281a] shadow-[0_14px_34px_-12px_rgba(52,211,153,0.6)] transition-all hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3ddc97]/70 disabled:cursor-wait disabled:opacity-70"
            >
              {savingAvatar ? "…" : t("welcome.done")}
            </button>
          )}
        </div>
      </div>
    </WelcomeShell>
  );
}

// ---------------------------------------------------------------------------
// Finale — the green celebration
// ---------------------------------------------------------------------------

const CONFETTI_BITS: Array<{
  x: number;
  y: number;
  color: string;
  delay: number;
  size: number;
}> = [
  { x: -74, y: -86, color: "#3ddc97", delay: 0.5, size: 7 },
  { x: 62, y: -96, color: "#a7f3d0", delay: 0.56, size: 6 },
  { x: -108, y: -30, color: "#17b26a", delay: 0.6, size: 6 },
  { x: 104, y: -44, color: "#3ddc97", delay: 0.52, size: 7 },
  { x: -52, y: 60, color: "#d1fae5", delay: 0.66, size: 5 },
  { x: 58, y: 66, color: "#34d399", delay: 0.62, size: 6 },
  { x: -118, y: 26, color: "#a7f3d0", delay: 0.7, size: 5 },
  { x: 118, y: 18, color: "#d1fae5", delay: 0.58, size: 5 },
  { x: 12, y: -112, color: "#17b26a", delay: 0.64, size: 6 },
  { x: -16, y: 92, color: "#3ddc97", delay: 0.68, size: 6 },
];

function FinaleCard({
  displayName,
  onDone,
}: {
  displayName: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="welcome-card relative w-[min(460px,100%)] overflow-hidden rounded-[26px] border border-white/[0.09] px-[36px] py-[38px] text-center shadow-[0_40px_120px_-24px_rgba(0,0,0,0.7)] backdrop-blur-2xl"
      style={{
        background:
          "linear-gradient(160deg, rgba(255,255,255,0.075), rgba(255,255,255,0.04))",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-[26px] top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent"
      />

      {/* the green thing: pop-in badge + drawn check + expanding rings + confetti */}
      <div className="relative mx-auto h-[104px] w-[104px]">
        <span
          aria-hidden
          className="welcome-ring absolute inset-[-6px] rounded-full border-2 border-[#34d399]/50"
        />
        <span
          aria-hidden
          className="welcome-ring welcome-ring-slow absolute inset-[-6px] rounded-full border-2 border-[#34d399]/30"
        />
        <div className="welcome-pop absolute inset-0 flex items-center justify-center rounded-full bg-gradient-to-b from-[#3ddc97] to-[#17b26a] shadow-[0_18px_50px_-12px_rgba(52,211,153,0.55)]">
          <svg viewBox="0 0 24 24" className="h-[52px] w-[52px]" aria-hidden="true">
            <path
              className="welcome-check"
              d="M5 12.5L10 17.5L19 7.5"
              stroke="white"
              strokeWidth="2.6"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        {CONFETTI_BITS.map((bit, i) => (
          <span
            key={i}
            aria-hidden
            className="welcome-confetti absolute left-1/2 top-1/2 rounded-[2px]"
            style={{
              width: bit.size,
              height: bit.size,
              background: bit.color,
              animationDelay: `${bit.delay}s`,
              ["--cx" as string]: `${bit.x}px`,
              ["--cy" as string]: `${bit.y}px`,
            }}
          />
        ))}
      </div>

      <div className="mt-[20px]">
        <WelcomeBrandRow compact />
      </div>

      <h1 className="mt-[18px] text-[27px] font-extrabold leading-tight tracking-wide text-white">
        {t("welcome.finale_title")}
      </h1>

      <p className="mt-[10px] text-[14.5px] leading-relaxed text-white/70">
        {t("welcome.finale_body", { name: displayName })}
      </p>

      <Button
        onClick={onDone}
        size="lg"
        className="mt-[26px] w-full cursor-pointer rounded-[16px] bg-gradient-to-b from-[#3ddc97] to-[#17b26a] !text-[#06281a] text-[15px] font-bold shadow-[0_14px_34px_-12px_rgba(52,211,153,0.6)] hover:brightness-105"
      >
        {t("welcome.finale_cta")}
      </Button>
    </div>
  );
}
