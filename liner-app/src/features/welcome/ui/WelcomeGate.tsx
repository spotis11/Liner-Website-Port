// Routes the welcome overlay: sign-in greeting vs. sign-up onboarding.
// Mounted next to the BanGate in App — it covers the whole app once the
// session is live. A persisted sign-up flow resumes after refreshes; the
// sign-in greeting never does.

import { useEffect } from "react";
import { useAuthStore } from "@/features/auth";
import { useWelcomeStore } from "../store/welcomeStore";
import { WelcomeBackScreen } from "./WelcomeBackScreen";
import { OnboardingWizard } from "./OnboardingWizard";

export function WelcomeGate() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const active = useWelcomeStore((s) => s.active);
  const syncSession = useWelcomeStore((s) => s.syncSession);

  // Once the session identity is known, adopt (or drop) any persisted
  // sign-up flow so a refresh mid-onboarding lands back in the wizard.
  useEffect(() => {
    if (status === "authenticated") {
      syncSession(user?.username ?? "");
    }
  }, [status, user, syncSession]);

  if (status !== "authenticated" || !user || !active) return null;

  const sessionUsername = user.username ?? "";
  // Stale flows for a different account must never render.
  if (active.username && active.username !== sessionUsername) return null;

  const displayName = user.displayName || user.username || "there";

  if (active.kind === "signin") {
    return <WelcomeBackScreen displayName={displayName} />;
  }
  return <OnboardingWizard />;
}
