import { useTranslation } from "@/languages";
import { HammerLine, ClockLine } from "@mingcute/react";
import { LoginBackdrop } from "@/features/auth/ui/LoginBackdrop";
import logo from "@/assets/logo.svg";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

/**
 * Full-screen maintenance wall rendered by the MaintenanceGate while the
 * website backend reports the site as under maintenance. Covers the whole
 * app, including the login page — sign-in and playback are impossible while
 * it is up — and, mirrored to localStorage by the maintenance store,
 * survives normal and hard refreshes.
 *
 * Branded like the banned wall / login screen (Liner logo + wordmark over
 * the login backdrop) but with a calm amber treatment: maintenance is a
 * "come back later", not a punishment.
 */
export function MaintenanceScreen({ reasons }: { reasons: string[] }) {
  const { t } = useTranslation();

  return (
    <div
      className="fixed inset-0 z-[9999] overflow-hidden bg-login-backdrop"
      role="alertdialog"
      aria-live="assertive"
      aria-label={t("maintenance.title")}
      style={font}
    >
      {/* branded backdrop: same glows + Liner stroke art as the login page */}
      <div className="maintenance-fade absolute inset-0 opacity-70">
        <LoginBackdrop edgeToEdge />
      </div>

      {/* the Liner glyph as a giant banner watermark behind the card */}
      <img
        src={logo}
        alt=""
        aria-hidden="true"
        width={45}
        height={35}
        draggable={false}
        className="pointer-events-none absolute left-1/2 top-1/2 h-auto w-[min(760px,120vw)] -translate-x-1/2 -translate-y-[64%] select-none mask-b-from-35% mask-b-to-92% opacity-[0.07]"
      />

      {/* soft amber glow behind the card */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[280px] w-[460px] max-w-[94vw] -translate-x-1/2 -translate-y-[58%] rounded-full bg-[#ffb020]/[0.14] blur-[120px]"
      />

      <div className="relative z-10 flex min-h-full items-center justify-center px-[24px] py-[48px]">
        <div
          className="relative w-[min(430px,100%)] overflow-hidden rounded-[26px] border border-white/[0.09] text-center shadow-[0_40px_120px_-24px_rgba(0,0,0,0.7)] backdrop-blur-2xl"
          style={{
            background:
              "linear-gradient(168deg, rgba(255,255,255,0.075) 0%, rgba(255,255,255,0.042) 55%, rgba(255,255,255,0.058) 100%)",
            boxShadow:
              "0 40px 120px -24px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.09)",
          }}
        >
          {/* amber accent strip */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-[3px] bg-linear-to-r from-transparent via-[#ffb020]/90 to-transparent"
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

            {/* maintenance badge */}
            <span
              aria-hidden
              className="mt-[24px] flex h-[68px] w-[68px] animate-pulse items-center justify-center rounded-[22px] text-[#ffc555] ring-1 ring-[#ffb020]/30"
              style={{ background: "rgba(255,176,32,0.12)" }}
            >
              <HammerLine style={{ fontSize: 40 }} />
            </span>

            <h1 className="m-0 mt-[18px] font-montserrat text-[23px] font-[800] leading-tight tracking-[-0.02em] text-white">
              {t("maintenance.title")}
            </h1>
            <p
              className="m-0 mt-[10px] max-w-[350px] text-[14px] leading-[1.65] text-white/62"
              style={{ textWrap: "pretty" }}
            >
              {t("maintenance.body")}
            </p>

            {/* possible reasons */}
            {reasons.length > 0 ? (
              <ul className="m-0 mt-[16px] flex w-full max-w-[330px] list-none flex-col gap-[6px] p-0 text-left">
                {reasons.map((reason) => (
                  <li
                    key={reason}
                    className="flex items-start gap-[8px] rounded-[10px] border border-white/[0.07] bg-white/[0.06] px-[12px] py-[7px] text-[12.5px] leading-[1.45] text-white/72"
                  >
                    <span
                      aria-hidden
                      className="mt-[5px] h-[6px] w-[6px] shrink-0 rounded-full bg-[#ffb020]/80"
                    />
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <span
              className="mt-[16px] inline-flex items-center gap-[6px] rounded-full px-[13px] py-[6px] text-[12.5px] leading-[1.4] text-[#ffd58a] ring-1 ring-[#ffb020]/30"
              style={{ background: "rgba(255,176,32,0.12)" }}
            >
              <ClockLine aria-hidden style={{ fontSize: 14 }} />
              {t("maintenance.footer")}
            </span>

            <p className="m-0 mt-[10px] max-w-[330px] text-[11px] leading-[1.5] text-white/40">
              {t("maintenance.retry_note")}
            </p>

            <div
              aria-hidden
              className="mt-[22px] h-px w-full bg-linear-to-r from-transparent via-white/12 to-transparent"
            />
            <span className="mt-[13px] text-[10.5px] uppercase tracking-[0.24em] text-white/38">
              {t("maintenance.stamp")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MaintenanceScreen;
