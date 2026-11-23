import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import Button from "@classic/shared/ui/Button";
import TextInput from "@classic/shared/ui/TextInput";
import { EyeLine, EyeCloseLine, DiscordFill } from "@mingcute/react";
import LoginBrandPanel from "./LoginBrandPanel";
import LoginBackdrop from "./LoginBackdrop";
import { useWindowState } from "@classic/features/navigation/hooks/useWindowState";
import {
  authErrorMessage,
  getAuthErrorCode,
  useAuthStore,
} from "../store/authStore";
import { useTranslation } from "@classic/languages";
import { HumanCheckNotice } from "@classic/features/human-check";
import { useAppearanceStore } from "@classic/features/settings/store/appearanceStore";
import { cn } from "@classic/shared/lib";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Sign-ups are upstream-only: accounts are created on the original Liner
// website (tryliner.fun), never here — the Create account tab is a pointer
// there, not a form. Download follows tryliner.fun's own download CTA target.
const ORIGINAL_LINER_URL = "https://tryliner.fun";
const LINER_DOWNLOAD_URL =
  "https://github.com/tryliner/desktop/releases/latest";

// Same look as @classic/shared/ui/Button's primary/outline variants, rendered
// as <a> so the external actions keep real link semantics (middle-click etc.).
const externalLinkBase =
  "inline-flex h-[44px] w-full items-center justify-center gap-[8px] rounded-control text-[13.5px] font-[400] transition-colors duration-150 active:scale-[0.96] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary/70 focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary";
const externalLinkPrimary =
  "border border-transparent bg-btn-primary-bg text-btn-primary-text hover:opacity-90";
const externalLinkOutline =
  "border border-border-alpha-14 bg-transparent text-text-primary hover:bg-border-alpha-14";

export default function LoginPage() {
  const navigate = useNavigate();
  const { isEdgeToEdge } = useWindowState();
  const login = useAuthStore((state) => state.login);
  const guestLogin = useAuthStore((state) => state.guestLogin);
  const { t } = useTranslation();
  // Whole-app design picked in Settings → Appearance ("original" default);
  // the classic and redesign trees share this one setting.
  const loginVariant = useAppearanceStore((state) => state.uiStyle);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const selectMode = (next: "login" | "register") => {
    if (submitting || next === mode) return;
    setMode(next);
    setError("");
  };

  // discord oauth: full-page navigation to the server route (it bounces the
  // browser to Discord's authorize screen and back into #/auth/discord)
  const handleDiscord = () => {
    if (submitting) return;
    setError("");
    window.location.assign("/api/auth/discord/start");
  };

  // guest mode: one tap, no email/password — a real (permanent) account is
  // minted on this website's own database and signed in immediately
  const handleGuest = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await guestLogin();
      navigate("/", { replace: true });
    } catch (nextError) {
      setError(resolveErrorMessage(nextError));
    } finally {
      setSubmitting(false);
    }
  };

  const resolveErrorMessage = (nextError: unknown): string => {
    const code = getAuthErrorCode(nextError);
    if (code === "server_unavailable")
      return t("login.errors.server_unavailable");
    if (code === "server_error") return t("login.errors.server_error");
    if (code === "invalid_credentials")
      return t("login.errors.invalid_credentials");
    if (code === "discord_only") return t("login.errors.discord_only");
    if (code === "email_already_used")
      return t("login.errors.email_already_used");
    if (code === "username_taken") return t("login.errors.username_taken");
    if (code === "weak_password") return t("login.errors.password_min_8");
    if (code === "invalid_username") return t("login.errors.username_invalid");
    if (code === "invalid_input")
      return t("login.errors.display_name_required");
    if (code === "human_check_cancelled")
      return t("login.errors.human_check_cancelled");
    if (code === "human_check_failed")
      return t("login.errors.human_check_failed");
    return authErrorMessage(nextError);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalizedEmail)) {
      setError(t("login.errors.email_invalid"));
      return;
    }
    if (password.length < 8) {
      setError(t("login.errors.password_min_8"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await login(normalizedEmail, password);
      navigate("/", { replace: true });
    } catch (nextError) {
      setError(resolveErrorMessage(nextError));
    } finally {
      setSubmitting(false);
    }
  };

  const heading =
    mode === "login"
      ? t("login.auth_title_login")
      : t("login.auth_title_register_disabled");
  const subheading =
    mode === "login"
      ? t("login.auth_subtitle_login")
      : t("login.auth_subtitle_register_disabled");

  return (
    <main
      className={cn(
        "relative flex h-full w-full items-center justify-center overflow-hidden bg-bg-primary",
        isEdgeToEdge
          ? "rounded-none border-0"
          : "rounded-5xl border border-border-primary",
      )}
    >
      <LoginBackdrop edgeToEdge={isEdgeToEdge} variant={loginVariant} />

      <section className="relative z-10 mx-4 my-auto grid max-h-[calc(100%-48px)] w-full max-w-[780px] grid-cols-[300px_1fr] gap-[8px] overflow-y-auto rounded-[20px] border border-border-primary bg-bg-panel p-[8px]">
        <LoginBrandPanel
          title={heading}
          subtitle={subheading}
          variant={loginVariant}
        />

        <div className="flex w-full flex-col px-[28px] pb-[22px] pt-[26px]">
          <div className="flex flex-col pb-6">
            <div className="w-full">
              <div className="flex gap-[8px]">
                {(
                  [
                    { id: "login", label: t("login.btn_sign_in") },
                    { id: "register", label: t("login.btn_create_account") },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectMode(item.id)}
                    className={`h-[38px] flex-1 cursor-pointer rounded-[10px] border-none text-[13.5px] font-[500] transition-colors duration-150 ${
                      mode === item.id
                        ? "bg-btn-primary-bg text-btn-primary-text"
                        : "bg-bg-elevated text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <AnimatePresence initial={false} mode="wait">
                {mode === "login" ? (
                  <motion.form
                    key="login-form"
                    noValidate
                    onSubmit={submit}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{
                      duration: 0.18,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className="mt-[22px] flex flex-col"
                  >
                    <label
                      className="mb-[7px] text-caption font-[500] text-text-secondary"
                      htmlFor="auth-email"
                    >
                      {t("login.label_email")}
                    </label>
                    <TextInput
                      id="auth-email"
                      autoFocus
                      type="email"
                      inputMode="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      autoComplete="email"
                      placeholder={t("login.placeholder_email")}
                      value={email}
                      hasError={Boolean(error)}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? "auth-form-error" : undefined}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        if (error) setError("");
                      }}
                      disabled={submitting}
                    />

                    <label
                      className="mb-[7px] mt-[15px] text-caption font-[500] text-text-secondary"
                      htmlFor="auth-password"
                    >
                      {t("login.label_password")}
                    </label>
                    <TextInput
                      id="auth-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder={t("login.placeholder_password")}
                      value={password}
                      hasError={Boolean(error)}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? "auth-form-error" : undefined}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        if (error) setError("");
                      }}
                      disabled={submitting}
                      rightSlot={
                        <button
                          type="button"
                          aria-label={
                            showPassword
                              ? t("login.hide_password")
                              : t("login.show_password")
                          }
                          onClick={() => setShowPassword((v) => !v)}
                          className="flex h-7 w-7 items-center justify-center rounded-item text-text-tertiary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-text-secondary cursor-pointer"
                        >
                          {showPassword ? (
                            <EyeCloseLine className="h-4 w-4" />
                          ) : (
                            <EyeLine className="h-4 w-4" />
                          )}
                        </button>
                      }
                    />

                    <div className="min-h-[22px] py-[6px]">
                      <AnimatePresence mode="wait" initial={false}>
                        {error && (
                          <motion.p
                            key={error}
                            id="auth-form-error"
                            role="alert"
                            initial={{ opacity: 0, y: -3 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="m-0 text-caption font-[500] leading-[1.4] text-accent-primary"
                          >
                            {error}
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>

                    <Button
                      type="submit"
                      disabled={submitting}
                      className="mt-[2px] w-full"
                    >
                      {submitting ? (
                        <>
                          <span className="h-[14px] w-[14px] animate-spin rounded-full border-2 border-current border-t-transparent" />
                          <span>{t("login.btn_signing_in")}</span>
                        </>
                      ) : (
                        t("login.btn_sign_in")
                      )}
                    </Button>

                    {/* Website-only sign-in options: Discord-OAuth and guest
                        accounts mint website sessions (`at_`/`rt_` tokens) —
                        the /v1 relay serves them from this site's own backend,
                        while email/password sign-ins continue upstream
                        (tryliner). New sign-ups are NOT offered here (see the
                        Create account tab) — these are for returning users. */}
                    <div className="mt-[16px] flex items-center gap-[12px]">
                      <span className="h-px flex-1 bg-border-primary" />
                      <span className="text-[11px] font-[500] uppercase tracking-wide text-text-tertiary">
                        {t("login.or")}
                      </span>
                      <span className="h-px flex-1 bg-border-primary" />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={submitting}
                      onClick={handleDiscord}
                      className="mt-[12px] w-full"
                    >
                      <span className="inline-flex" style={{ color: "#5865F2" }}>
                        <DiscordFill className="h-4 w-4" />
                      </span>
                      <span>{t("login.btn_discord")}</span>
                    </Button>
                    <p className="m-0 mt-[8px] text-center text-[11px] leading-[1.5] text-text-tertiary">
                      {t("login.discord_hint")}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={submitting}
                      onClick={handleGuest}
                      className="mt-[10px] w-full"
                    >
                      {submitting ? (
                        <span className="h-[14px] w-[14px] animate-spin rounded-full border-2 border-current border-t-transparent" />
                      ) : (
                        t("login.btn_guest")
                      )}
                    </Button>
                    <p className="m-0 mt-[8px] text-center text-[11px] leading-[1.5] text-text-tertiary">
                      {t("login.guest_hint")}
                    </p>
                  </motion.form>
                ) : (
                  <motion.div
                    key="register-notice"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{
                      duration: 0.18,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className="mt-[22px] flex flex-col"
                  >
                    {/* No sign-up form here on purpose: accounts exist only
                        on the original Liner site — this panel just says so
                        and hands visitors the links they need. */}
                    <div className="flex flex-col rounded-item border border-border-alpha-14 bg-bg-elevated px-[20px] py-[22px] text-center">
                      <p className="m-0 text-[15px] font-[600] text-text-primary">
                        {t("login.register_disabled_title")}
                      </p>
                      <p className="m-0 mt-[10px] text-[13px] leading-[1.6] text-text-secondary">
                        {t("login.register_disabled_body")}
                      </p>
                    </div>
                    <a
                      href={ORIGINAL_LINER_URL}
                      target="_blank"
                      rel="noreferrer"
                      className={`${externalLinkBase} ${externalLinkPrimary} mt-[14px]`}
                    >
                      {t("login.btn_create_on_original")}
                    </a>
                    <a
                      href={LINER_DOWNLOAD_URL}
                      target="_blank"
                      rel="noreferrer"
                      className={`${externalLinkBase} ${externalLinkOutline} mt-[10px]`}
                    >
                      {t("login.btn_download_liner")}
                    </a>
                    <p className="m-0 mt-[10px] text-center text-[11px] leading-[1.5] text-text-tertiary">
                      {t("login.register_disabled_hint")}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Bottom: legal warning */}
          <p className="m-0 shrink-0 text-center text-[11px] leading-[1.5] text-text-tertiary">
            {t("login.legal")}{" "}
            <a
              href="https://tryliner.fun/terms"
              target="_blank"
              rel="noreferrer"
              className="text-text-secondary underline underline-offset-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-text-primary rounded-xs transition-colors"
            >
              {t("login.legal_tos")}
            </a>{" "}
            {t("login.legal_and")}{" "}
            <a
              href="https://tryliner.fun/privacy"
              target="_blank"
              rel="noreferrer"
              className="text-text-secondary underline underline-offset-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-text-primary rounded-xs transition-colors"
            >
              {t("login.legal_pp")}
            </a>
            .
          </p>
        </div>
      </section>
      <HumanCheckNotice />
    </main>
  );
}
