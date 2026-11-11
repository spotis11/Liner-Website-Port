import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { DiscordFill, WarningFill } from "@mingcute/react";
import Button from "@/shared/ui/Button";
import LoginBackdrop from "./LoginBackdrop";
import { useWindowState } from "@/features/navigation/hooks/useWindowState";
import { useAuthStore, type DiscordLoginPayload } from "../store/authStore";
import { useTranslation } from "@/languages";
import { cn } from "@/shared/lib";

/**
 * Landing for /api/auth/discord/callback. The Next.js route redirects here
 * with the freshly minted session in the URL FRAGMENT (never sent to a
 * server): #/auth/discord?at=…&rt=…&exp=…&user=… (base64url PublicUser) —
 * or #/auth/discord?error=… when Discord or the exchange failed.
 *
 * This page consumes the fragment exactly once, installs the session through
 * the same gates as every other sign-in (ban wall, welcome greeting), wipes
 * the tokens out of the address bar, and lands on the home screen.
 */

function decodeUserParam(raw: string | null): DiscordLoginPayload["user"] | null {
  if (!raw) return null;
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded)) as Record<string, unknown>;
    if (!parsed || typeof parsed.username !== "string") return null;
    // the fragment only carries the fields a session needs — normalize to the
    // same shape every other sign-in installs
    return {
      id: String(parsed.id ?? ""),
      email: typeof parsed.email === "string" ? parsed.email : undefined,
      username: String(parsed.username),
      displayName: String(parsed.displayName ?? parsed.username),
      avatarUrl:
        typeof parsed.avatarUrl === "string" ? parsed.avatarUrl : null,
      bio: null,
      isPublic: parsed.isPublic !== false,
      showActivity: parsed.showActivity !== false,
      showHistory: parsed.showHistory !== false,
      showLikedTracks: parsed.showLikedTracks !== false,
      participateLeaderboards: parsed.participateLeaderboards !== false,
    };
  } catch {
    return null;
  }
}

export default function DiscordCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isEdgeToEdge } = useWindowState();
  const { t } = useTranslation();
  const completeDiscordLogin = useAuthStore(
    (state) => state.completeDiscordLogin,
  );
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const errorParam = searchParams.get("error");
    const at = searchParams.get("at");
    const rt = searchParams.get("rt");
    const exp = searchParams.get("exp");
    const user = decodeUserParam(searchParams.get("user"));

    // consume the fragment immediately so the tokens never linger in the
    // address bar / browser history
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search + "#/auth/discord",
    );

    if (errorParam) {
      setError(
        errorParam === "denied"
          ? t("login.discord_error_denied")
          : t("login.discord_error"),
      );
      return;
    }
    if (!at || !rt || !exp || !user) {
      setError(t("login.discord_error"));
      return;
    }

    completeDiscordLogin({ accessToken: at, refreshToken: rt, accessTokenExpiresAt: exp, user })
      .then(() => navigate("/", { replace: true }))
      .catch(() => setError(t("login.discord_error")));
  }, [completeDiscordLogin, navigate, searchParams, t]);

  return (
    <main className="relative flex h-full flex-col overflow-hidden">
      <LoginBackdrop />
      <section
        className={cn(
          "relative z-10 flex flex-1 flex-col items-center justify-center",
          isEdgeToEdge ? "px-4" : "px-[26px] pb-[34px]",
        )}
      >
        <div className="flex w-full max-w-[420px] flex-col items-center rounded-[20px] border border-border-primary bg-bg-surface/80 p-[28px] shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          {error ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="flex w-full flex-col items-center gap-[14px] text-center"
            >
              <span className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
                <WarningFill size={22} />
              </span>
              <h1 className="m-0 text-[17px] font-[600] text-text-primary">
                {t("login.discord_error_title")}
              </h1>
              <p className="m-0 text-[13px] leading-[1.5] text-text-secondary">
                {error}
              </p>
              <Button
                variant="outline"
                className="mt-[4px] w-full"
                onClick={() => navigate("/login", { replace: true })}
              >
                {t("login.discord_back_to_login")}
              </Button>
            </motion.div>
          ) : (
            <div className="flex w-full flex-col items-center gap-[16px] text-center">
              <span className="relative flex h-[44px] w-[44px] items-center justify-center rounded-full bg-[#5865F2]/15 text-[#8b94f7]">
                <DiscordFill size={22} />
                <span className="absolute inset-0 rounded-full border-2 border-[#5865F2]/30 border-t-transparent animate-spin" />
              </span>
              <h1 className="m-0 text-[17px] font-[600] text-text-primary">
                {t("login.discord_signing_in")}
              </h1>
              <p className="m-0 text-[12.5px] leading-[1.5] text-text-tertiary">
                {t("login.discord_hint")}
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
