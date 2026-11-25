import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { EyeLine, EyeCloseLine, DiscordFill } from "@mingcute/react";
import { useWindowState } from "@/features/navigation/hooks/useWindowState";
import {
  authErrorMessage,
  getAuthErrorCode,
  useAuthStore,
} from "../store/authStore";
import { useTranslation, LOCALE_OPTIONS } from "@/languages";
import { HumanCheckNotice } from "@/features/human-check";
import { cn } from "@/shared/lib";
import logo from "@/assets/logo.svg";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Sign-ups are upstream-only: accounts are created on the original Liner
// website (tryliner.fun), never here — the Create account tab is a pointer
// there, not a form. Download follows tryliner.fun's own download CTA target.
const ORIGINAL_LINER_URL = "https://tryliner.fun";
const LINER_DOWNLOAD_URL =
  "https://github.com/tryliner/desktop/releases/latest";

// 0.2.20 beta login look (owner-requested port, 2026-11-25): full-bleed dark
// stage, halftone backdrop art on the left, form column on the right. The
// palette is hardcoded (not app tokens) so the screen stays beta-dark in
// every app theme. All behaviour is the fan login's: email sign-in rides the
// upstream relay, Discord + guest mint website sessions, and "Create
// account" stays the upstream-only pointer (Cloudflare blocks sign-ups from
// our servers — the notice panel says so).
const PAGE_BG = "#0b0b0c";
const PILL_BG = "#1e1e22";
const PILL_BG_HOVER = "#27272c";
const FIELD_BG = "#1b1b1f";
const FIELD_BORDER = "#2e2e33";
const FIELD_BORDER_FOCUS = "#4a4a52";
const BLUE = "#5b6bf7";
const BLUE_HOVER = "#4d5ef0";
const TEXT_PRIMARY = "#f2f2f4";
const TEXT_SECONDARY = "#9a9aa0";
const TEXT_TERTIARY = "#7c7c83";

const guestIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
    <path d="M4.5 20c.8-3 3.9-4.5 7.5-4.5s6.7 1.5 7.5 4.5" />
  </svg>
);

export default function LoginPage() {
  const navigate = useNavigate();
  const { isEdgeToEdge } = useWindowState();
  const login = useAuthStore((state) => state.login);
  const guestLogin = useAuthStore((state) => state.guestLogin);
  const { t, locale: currentLocale, setLocale } = useTranslation();
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

  const pillBase =
    "inline-flex h-[44px] flex-1 items-center justify-center gap-[7px] whitespace-nowrap rounded-[10px] border-0 px-[10px] text-[12.5px] font-[500] transition-colors duration-150 active:scale-[0.98] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40";

  const fieldLabel = "mb-[7px] text-[13px] font-[500] text-[#c9c9ce]";
  const fieldInput =
    "h-[44px] w-full rounded-[10px] border px-[14px] text-[14px] outline-none transition-colors duration-150 placeholder:text-[#6f6f75] focus-visible:outline-none";

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
        "relative flex h-full w-full overflow-hidden",
        isEdgeToEdge
          ? "rounded-none border-0"
          : "rounded-item border border-[#232327]",
      )}
      style={{ backgroundColor: PAGE_BG, color: TEXT_PRIMARY }}
    >
      {/* left halftone art — the 0.2.20 backdrop asset, faded into the stage
          and pulled to the beta's dark monochrome look */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 hidden w-[52%] select-none md:block"
        style={{
          backgroundImage: "url(/liner/my-wave-backdrop.png)",
          backgroundSize: "cover",
          backgroundPosition: "center left",
          opacity: 0.5,
          filter: "grayscale(0.92) brightness(0.42) contrast(1.05)",
          maskImage:
            "linear-gradient(to right, black 55%, transparent 98%)",
          WebkitMaskImage:
            "linear-gradient(to right, black 55%, transparent 98%)",
        }}
      />

      {/* logo top-left, white like the beta */}
      <img
        src={logo}
        alt="Liner"
        className="absolute left-[26px] top-[22px] z-20 h-[26px] w-auto select-none"
        style={{ filter: "brightness-0 invert" }}
      />

      {/* right form column */}
      <div className="relative z-10 flex h-full w-full items-center justify-center md:justify-end">
        <div className="w-full max-w-[400px] px-[22px] pb-[86px] pt-[40px] md:pb-[60px] md:pr-[64px]">
          <AnimatePresence initial={false} mode="wait">
            {mode === "login" ? (
              <motion.div
                key="login-beta"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                <h1 className="m-0 text-[26px] font-[700] leading-[1.15] text-white">
                  {heading}
                </h1>
                <p className="m-0 mt-[8px] text-[14px] leading-[1.5]" style={{ color: TEXT_SECONDARY }}>
                  {subheading}
                </p>

                {/* website sessions: guest + Discord — the two paths that
                    work entirely on this site */}
                <div className="mt-[26px] flex gap-[10px]">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleGuest}
                    className={pillBase}
                    style={{ backgroundColor: PILL_BG, color: TEXT_PRIMARY }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = PILL_BG_HOVER;
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = PILL_BG;
                    }}
                  >
                    {submitting ? (
                      <span className="h-[14px] w-[14px] animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      guestIcon
                    )}
                    <span>{t("login.btn_guest")}</span>
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleDiscord}
                    className={pillBase}
                    style={{ backgroundColor: PILL_BG, color: TEXT_PRIMARY }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = PILL_BG_HOVER;
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = PILL_BG;
                    }}
                  >
                    <DiscordFill className="h-4 w-4" />
                    <span>{t("login.btn_discord")}</span>
                  </button>
                </div>

                <div className="my-[20px] flex items-center gap-[14px]">
                  <span className="h-px flex-1" style={{ backgroundColor: "#2a2a2f" }} />
                  <span className="text-[12px] font-[500]" style={{ color: TEXT_TERTIARY }}>
                    {t("login.or")}
                  </span>
                  <span className="h-px flex-1" style={{ backgroundColor: "#2a2a2f" }} />
                </div>

                <form noValidate onSubmit={submit} className="flex flex-col">
                  <label className={fieldLabel} htmlFor="auth-email">
                    {t("login.label_email")}
                  </label>
                  <input
                    id="auth-email"
                    autoFocus
                    type="email"
                    inputMode="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoComplete="email"
                    placeholder={t("login.placeholder_email") || "you@example.com"}
                    value={email}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "auth-form-error" : undefined}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      if (error) setError("");
                    }}
                    disabled={submitting}
                    className={fieldInput}
                    style={{
                      backgroundColor: FIELD_BG,
                      borderColor: error ? "#e05666" : FIELD_BORDER,
                      color: TEXT_PRIMARY,
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = FIELD_BORDER_FOCUS;
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = error ? "#e05666" : FIELD_BORDER;
                    }}
                  />

                  <div className="mt-[16px] flex items-baseline justify-between">
                    <label className={fieldLabel} htmlFor="auth-password">
                      {t("login.label_password")}
                    </label>
                  </div>
                  <div className="relative">
                    <input
                      id="auth-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder={t("login.placeholder_password") || "Your password"}
                      value={password}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? "auth-form-error" : undefined}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        if (error) setError("");
                      }}
                      disabled={submitting}
                      className={cn(fieldInput, "pr-[42px]")}
                      style={{
                        backgroundColor: FIELD_BG,
                        borderColor: error ? "#e05666" : FIELD_BORDER,
                        color: TEXT_PRIMARY,
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = FIELD_BORDER_FOCUS;
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = error ? "#e05666" : FIELD_BORDER;
                      }}
                    />
                    <button
                      type="button"
                      aria-label={
                        showPassword
                          ? t("login.hide_password")
                          : t("login.show_password")
                      }
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-[10px] top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent p-0 cursor-pointer transition-colors hover:opacity-100"
                      style={{ color: TEXT_TERTIARY }}
                    >
                      {showPassword ? (
                        <EyeCloseLine className="h-4 w-4" />
                      ) : (
                        <EyeLine className="h-4 w-4" />
                      )}
                    </button>
                  </div>

                  <div className="min-h-[20px] pt-[8px]">
                    <AnimatePresence mode="wait" initial={false}>
                      {error && (
                        <motion.p
                          key={error}
                          id="auth-form-error"
                          role="alert"
                          initial={{ opacity: 0, y: -3 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className="m-0 text-[12px] font-[500] leading-[1.4]"
                          style={{ color: "#ff7b7b" }}
                        >
                          {error}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="mt-[6px] inline-flex h-[44px] w-full items-center justify-center gap-[8px] rounded-[10px] border-0 text-[14px] font-[600] text-white transition-all duration-150 active:scale-[0.98] cursor-pointer disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                    style={{ backgroundColor: BLUE }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = BLUE_HOVER;
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = BLUE;
                    }}
                  >
                    {submitting ? (
                      <>
                        <span className="h-[14px] w-[14px] animate-spin rounded-full border-2 border-current border-t-transparent" />
                        <span>{t("login.btn_signing_in")}</span>
                      </>
                    ) : (
                      t("login.btn_sign_in")
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => selectMode("register")}
                    className="mx-auto mt-[14px] flex items-center justify-center border-0 bg-transparent p-[2px] text-[13px] font-[500] cursor-pointer transition-colors hover:opacity-100"
                    style={{ color: TEXT_SECONDARY }}
                  >
                    {t("login.btn_create_account")}
                  </button>
                </form>
              </motion.div>
            ) : (
              <motion.div
                key="register-beta"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                <h1 className="m-0 text-[26px] font-[700] leading-[1.15] text-white">
                  {heading}
                </h1>
                <p className="m-0 mt-[8px] text-[14px] leading-[1.5]" style={{ color: TEXT_SECONDARY }}>
                  {subheading}
                </p>

                {/* No sign-up form here on purpose: sign-ups happen on the
                    original Liner site only — Cloudflare's human check blocks
                    account creation from our servers, so this panel says so
                    and hands visitors the official links instead. */}
                <div
                  className="mt-[24px] flex flex-col rounded-[14px] px-[20px] py-[22px]"
                  style={{ backgroundColor: PILL_BG }}
                >
                  <p className="m-0 text-[15px] font-[600] text-white">
                    {t("login.register_disabled_title")}
                  </p>
                  <p className="m-0 mt-[10px] text-[13px] leading-[1.6]" style={{ color: TEXT_SECONDARY }}>
                    {t("login.register_disabled_body")}
                  </p>
                </div>
                <a
                  href={ORIGINAL_LINER_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-[16px] inline-flex h-[44px] w-full items-center justify-center rounded-[10px] border-0 text-[14px] font-[600] text-white transition-all duration-150 active:scale-[0.98] cursor-pointer"
                  style={{ backgroundColor: BLUE }}
                >
                  {t("login.btn_create_on_original")}
                </a>
                <a
                  href={LINER_DOWNLOAD_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-[10px] inline-flex h-[44px] w-full items-center justify-center rounded-[10px] border text-[13.5px] font-[500] transition-colors duration-150 cursor-pointer"
                  style={{
                    backgroundColor: "transparent",
                    borderColor: FIELD_BORDER,
                    color: TEXT_PRIMARY,
                  }}
                >
                  {t("login.btn_download_liner")}
                </a>
                <p className="m-0 mt-[12px] text-center text-[11px] leading-[1.5]" style={{ color: TEXT_TERTIARY }}>
                  {t("login.register_disabled_hint")}
                </p>

                <button
                  type="button"
                  onClick={() => selectMode("login")}
                  className="mx-auto mt-[16px] flex items-center justify-center border-0 bg-transparent p-[2px] text-[13px] font-[500] cursor-pointer"
                  style={{ color: TEXT_SECONDARY }}
                >
                  ← {t("login.btn_sign_in")}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* bottom bar: language pill (left) + legal (right) — beta placement */}
      <div className="absolute inset-x-[22px] bottom-[18px] z-20 flex flex-wrap items-end justify-between gap-[10px] md:inset-x-[26px]">
        <div className="relative">
          <select
            aria-label={t("settings.language.label") || "Language"}
            value={currentLocale}
            onChange={(event) => setLocale(event.target.value as never)}
            className="h-[36px] cursor-pointer appearance-none rounded-[10px] border pl-[12px] pr-[30px] text-[13px] font-[500] outline-none"
            style={{
              backgroundColor: PILL_BG,
              borderColor: "transparent",
              color: TEXT_PRIMARY,
            }}
          >
            {LOCALE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke={TEXT_SECONDARY}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none absolute right-[10px] top-1/2 -translate-y-1/2"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
        <p className="m-0 max-w-[420px] text-right text-[11px] leading-[1.5]" style={{ color: TEXT_TERTIARY }}>
          {t("login.legal")}{" "}
          <a
            href="https://tryliner.fun/terms"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 transition-colors hover:text-white"
            style={{ color: TEXT_SECONDARY }}
          >
            {t("login.legal_tos")}
          </a>{" "}
          {t("login.legal_and")}{" "}
          <a
            href="https://tryliner.fun/privacy"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 transition-colors hover:text-white"
            style={{ color: TEXT_SECONDARY }}
          >
            {t("login.legal_pp")}
          </a>
          .
        </p>
      </div>
      <HumanCheckNotice />
    </main>
  );
}
