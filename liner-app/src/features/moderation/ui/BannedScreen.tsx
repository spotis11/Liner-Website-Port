import { useTranslation } from "@/languages";
import { ForbidCircleFill, ClockLine } from "@mingcute/react";
import { LoginBackdrop } from "@/features/auth/ui/LoginBackdrop";
import logo from "@/assets/logo.svg";
import { formatBanRemaining, type BanInfo } from "../lib/moderationApi";
import { useState } from "react";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

/**
 * Full-screen wall rendered by the BanGate when the website backend reports
 * the visitor (account or network) as banned. Covers the whole app,
 * including the login page, and — mirrored to localStorage by the ban store
 * — survives normal and hard refreshes.
 *
 * Branded like the login screen: Liner logo + wordmark, the big Liner mark
 * as banner art over the login backdrop. The backdrop is dark in both app
 * themes (by design — same as the auth screen), so the card uses fixed
 * dark-glass styling instead of theme tokens.
 */
export function BannedScreen({ ban }: { ban: BanInfo }) {
  const { t } = useTranslation();
  const [avatarBroken, setAvatarBroken] = useState(false);
  const showAvatar = !!ban.avatarUrl && !avatarBroken;

  const isNetwork = ban.type === "ip";
  const title = isNetwork
    ? t("moderation.banned.title_network")
    : t("moderation.banned.title_account");
  const body = isNetwork
    ? t("moderation.banned.body_network", { username: ban.username || "?" })
    : t("moderation.banned.body_account", { username: ban.username || "?" });

  const remaining = formatBanRemaining(ban.expiresAt);
  const expiry = remaining.forever
    ? t("moderation.banned.expires_never")
    : t("moderation.banned.expires_at", { time: remaining.text });

  return (
    <div
      className="fixed inset-0 z-[9999] overflow-hidden bg-login-backdrop"
      role="alertdialog"
      aria-live="assertive"
      aria-label={title}
      style={font}
    >
      {/* branded backdrop: same glows + Liner stroke art as the login page,
          softened so the wall reads calm and the banner art stands out */}
      <div className="ban-wall-fade absolute inset-0 opacity-70">
        <LoginBackdrop edgeToEdge />
      </div>

      {/* the Liner glyph as a giant banner watermark behind the card —
          the brand's most recognizable shape, echoing the login page art */}
      <img
        src={logo}
        alt=""
        aria-hidden="true"
        width={45}
        height={35}
        draggable={false}
        className="pointer-events-none absolute left-1/2 top-1/2 h-auto w-[min(760px,120vw)] -translate-x-1/2 -translate-y-[64%] select-none mask-b-from-35% mask-b-to-92% opacity-[0.07]"
      />

      {/* soft red glow behind the card */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[280px] w-[460px] max-w-[94vw] -translate-x-1/2 -translate-y-[58%] rounded-full bg-[#ff4d4d]/[0.16] blur-[120px]"
      />

      <div className="relative z-10 flex min-h-full items-center justify-center px-[24px] py-[48px]">
        <div
          className="ban-wall-card relative w-[min(430px,100%)] overflow-hidden rounded-[26px] border border-white/[0.09] text-center shadow-[0_40px_120px_-24px_rgba(0,0,0,0.7)] backdrop-blur-2xl"
          style={{
            background:
              "linear-gradient(168deg, rgba(255,255,255,0.075) 0%, rgba(255,255,255,0.042) 55%, rgba(255,255,255,0.058) 100%)",
            boxShadow:
              "0 40px 120px -24px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.09)",
          }}
        >
          {/* red accent strip */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-[3px] bg-linear-to-r from-transparent via-[#ff5a5f]/90 to-transparent"
          />

          <div className="flex flex-col items-center px-[30px] pb-[26px] pt-[28px]">
            {/* Liner brand row */}
            <div className="flex items-center gap-[9px]">
              <img
                src={logo}
                alt="Liner"
                width={45}
                height={35}
                draggable={false}
                className="h-[19px] w-auto object-contain select-none"
              />
              <span className="text-[16.5px] font-[650] tracking-[-0.03em] text-white/92">
                Liner
              </span>
            </div>

            {showAvatar ? (
              /* profile picture with the one-time red banned treatment:
                 pop-in -> red ring burst + flash -> BANNED stamp slams on
                 and stays. All animations run exactly once per page load. */
              <span className="relative mt-[22px] block h-[96px] w-[96px]">
                <img
                  src={ban.avatarUrl ?? undefined}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarBroken(true)}
                  className="ban-avatar-pop h-full w-full rounded-full object-cover ring-2 ring-[#ff5a5f]/45"
                  style={{ background: "rgba(255,77,77,0.12)" }}
                />
                <span
                  aria-hidden
                  className="ban-ring-burst pointer-events-none absolute inset-0 rounded-full border-2 border-[#ff5a5f]"
                />
                <span
                  aria-hidden
                  className="ban-avatar-flash pointer-events-none absolute inset-0 rounded-full bg-[#ff4d4d]"
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                >
                  <span className="ban-stamp-badge whitespace-nowrap rounded-[9px] border-[2.5px] border-[#ff5a5f]/90 bg-[#141417]/60 px-[9px] py-[3px] font-montserrat text-[13px] font-[800] uppercase leading-none tracking-[0.08em] text-[#ff6b70]">
                    {t("moderation.banned.stamp")}
                  </span>
                </span>
              </span>
            ) : (
              /* fallback badge when no profile picture is known */
              <span
                aria-hidden
                className="mt-[24px] flex h-[68px] w-[68px] items-center justify-center rounded-[22px] text-[#ff6b70] ring-1 ring-[#ff5a5f]/30"
                style={{ background: "rgba(255,77,77,0.12)" }}
              >
                <ForbidCircleFill style={{ fontSize: 40 }} />
              </span>
            )}

            <h1 className="m-0 mt-[18px] font-montserrat text-[23px] font-[800] leading-tight tracking-[-0.02em] text-white">
              {title}
            </h1>
            <p
              className="m-0 mt-[10px] max-w-[350px] text-[14px] leading-[1.65] text-white/62"
              style={{ textWrap: "pretty" }}
            >
              {body}
            </p>

            {/* reason + expiry chips */}
            <div className="mt-[18px] flex flex-wrap items-center justify-center gap-[8px]">
              {ban.reason ? (
                <span className="inline-flex max-w-[240px] items-center gap-[6px] rounded-full border border-white/[0.07] bg-white/[0.06] px-[13px] py-[6px] text-[12.5px] leading-[1.4] text-white/72">
                  <span className="shrink-0 font-[650] text-white/45">
                    {t("moderation.banned.reason_label")}
                  </span>
                  <span className="truncate">{ban.reason}</span>
                </span>
              ) : null}
              {remaining.forever ? (
                <span
                  className="inline-flex items-center gap-[6px] rounded-full px-[13px] py-[6px] text-[12.5px] leading-[1.4] text-[#ff8589] ring-1 ring-[#ff5a5f]/30"
                  style={{ background: "rgba(255,77,77,0.12)" }}
                >
                  <ClockLine aria-hidden style={{ fontSize: 14 }} />
                  {expiry}
                </span>
              ) : (
                <span className="inline-flex items-center gap-[6px] rounded-full border border-white/[0.07] bg-white/[0.06] px-[13px] py-[6px] text-[12.5px] leading-[1.4] text-white/72">
                  <ClockLine aria-hidden style={{ fontSize: 14 }} />
                  {expiry}
                </span>
              )}
            </div>

            <div
              aria-hidden
              className="mt-[24px] h-px w-full bg-linear-to-r from-transparent via-white/12 to-transparent"
            />
            <span className="mt-[14px] text-[10.5px] uppercase tracking-[0.24em] text-white/38">
              {t("moderation.banned.footer")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BannedScreen;
