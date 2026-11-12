import { useMemo, type ReactNode } from "react";
import { Crown } from "@solar-icons/react";
import {
  HeartLine,
  Sparkles2Line,
  BadgeLine,
  Edit2Line,
  Group2Line,
  StickerLine,
  TelegramFill,
  DiscordFill,
  CheckCircleFill,
} from "@mingcute/react";
import { useTranslation, getTranslationsForAllLocales } from "@/languages";
import { useAuthStore } from "@/features/auth";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

const openUrl = (url: string) =>
  window.open(url, "_blank", "noopener,noreferrer");

/** Discord profile of thearchyexpunged — the approval contact for Pro. */
const PRO_APPROVAL_DISCORD_URL = "https://discord.com/users/1083656421964513331";

interface ProBenefit {
  id: string;
  icon: ReactNode;
  titleKey: string;
  descKey: string;
}

// The Liner Pro benefit list — presented exactly as the Pro tier advertises it.
const BENEFITS: ProBenefit[] = [
  {
    id: "library",
    icon: <HeartLine size={19} />,
    titleKey: "settings.pro.b1_title",
    descKey: "settings.pro.b1_desc",
  },
  {
    id: "animated-profile",
    icon: <Sparkles2Line size={19} />,
    titleKey: "settings.pro.b2_title",
    descKey: "settings.pro.b2_desc",
  },
  {
    id: "frames-badge",
    icon: <BadgeLine size={19} />,
    titleKey: "settings.pro.b3_title",
    descKey: "settings.pro.b3_desc",
  },
  {
    id: "profile-editor",
    icon: <Edit2Line size={19} />,
    titleKey: "settings.pro.b4_title",
    descKey: "settings.pro.b4_desc",
  },
  {
    id: "listening-rooms",
    icon: <Group2Line size={19} />,
    titleKey: "settings.pro.b5_title",
    descKey: "settings.pro.b5_desc",
  },
  {
    id: "stickers",
    icon: <StickerLine size={19} />,
    titleKey: "settings.pro.b6_title",
    descKey: "settings.pro.b6_desc",
  },
];

export function ProTab({ searchQuery }: { searchQuery?: string }) {
  const { t } = useTranslation();
  const isPro = useAuthStore((s) => s.user?.isPro === true);

  const isMatch = useMemo(() => {
    if (!searchQuery?.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const searchableKeys = [
      "settings.tabs.pro",
      "settings.pro.description",
      "settings.pro.tagline",
      "settings.pro.benefits_title",
      "settings.pro.cta",
      "settings.pro.approval_title",
      "settings.pro.approval_desc",
      "settings.pro.active_title",
      ...BENEFITS.flatMap((b) => [b.titleKey, b.descKey]),
    ];
    return searchableKeys.some((k) =>
      getTranslationsForAllLocales(k).some((txt) =>
        txt.toLowerCase().includes(q),
      ),
    );
  }, [searchQuery]);

  if (!isMatch) return null;

  return (
    <div className="flex w-full flex-col gap-[14px]">
      {/* ── Hero ── */}
      <div className="relative flex min-h-[176px] w-full flex-col overflow-hidden rounded-[20px] bg-gradient-to-br from-amber-400/[0.14] via-black/[0.04] to-black/[0.04] p-[24px] dark:from-amber-400/[0.16] dark:via-white/[0.06] dark:to-white/[0.06]">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-[70px] right-[-50px] size-[260px] rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, rgba(245, 158, 11, 0.22), transparent)",
          }}
        />
        <div className="relative flex items-center gap-[14px]">
          <span className="flex size-[46px] shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br from-amber-300 to-amber-500 text-[#201700] shadow-[0_6px_18px_rgba(245,158,11,0.35)]">
            <Crown size={26} weight="Bold" />
          </span>
          <div className="flex min-w-0 flex-col gap-[3px]">
            <div className="flex items-center gap-[10px]">
              <span className="font-montserrat text-[22px] font-[700] leading-none text-text-primary">
                {t("settings.pro.title")}
              </span>
              <span className="inline-flex h-[20px] shrink-0 items-center rounded-full bg-gradient-to-r from-amber-300 to-amber-500 px-[9px] text-[11px] font-[700] tracking-[0.08em] text-[#201700] select-none">
                PRO
              </span>
            </div>
            <span
              className="text-[13px] leading-snug text-text-secondary"
              style={font}
            >
              {t("settings.pro.tagline")}
            </span>
          </div>
        </div>

        <div className="relative mt-auto flex items-center gap-[10px] pt-[24px]">
          {isPro ? (
            <div
              data-testid="pro-active-badge"
              className="flex h-[42px] items-center gap-[10px] rounded-[12px] border border-amber-400/40 bg-amber-400/[0.12] px-[20px] text-amber-600 dark:text-amber-300"
            >
              <CheckCircleFill size={19} />
              <span className="text-[15px] font-[600]">
                {t("settings.pro.active_title")}
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => openUrl(PRO_APPROVAL_DISCORD_URL)}
              data-testid="pro-approval-cta"
              className="flex h-[42px] cursor-pointer items-center gap-[10px] rounded-[12px] border-0 bg-gradient-to-r from-amber-400 to-amber-500 px-[20px] text-[15px] font-[600] text-[#201700] transition-[filter] hover:brightness-[1.07]"
            >
              <DiscordFill size={18} />
              {t("settings.pro.approval_button")}
            </button>
          )}
        </div>
      </div>

      {/* ── Active note / How to get Pro ── */}
      {isPro ? (
        <div
          data-testid="pro-active-note"
          className="flex items-start gap-[12px] rounded-[16px] border border-amber-400/30 bg-amber-400/[0.08] p-[16px]"
        >
          <span className="flex size-[36px] shrink-0 items-center justify-center rounded-[11px] bg-amber-400/[0.18] text-amber-500 dark:text-amber-300">
            <CheckCircleFill size={20} />
          </span>
          <span className="flex min-w-0 flex-col gap-[3px]">
            <span
              className="text-[13.5px] font-[600] leading-snug text-text-primary"
              style={font}
            >
              {t("settings.pro.active_title")}
            </span>
            <span
              className="text-[12.5px] leading-snug text-text-secondary"
              style={font}
            >
              {t("settings.pro.active_desc")}
            </span>
          </span>
        </div>
      ) : (
        <div
          data-testid="pro-approval-note"
          className="flex flex-col gap-[10px] rounded-[16px] border border-amber-400/30 bg-amber-400/[0.08] p-[16px]"
        >
          <span
            className="text-[13px] font-[600] text-text-primary"
            style={font}
          >
            {t("settings.pro.approval_title")}
          </span>
          <span
            className="text-[12.5px] leading-snug text-text-secondary"
            style={font}
          >
            {t("settings.pro.approval_desc")}
          </span>
          <div>
            <button
              type="button"
              onClick={() => openUrl(PRO_APPROVAL_DISCORD_URL)}
              className="flex h-[36px] cursor-pointer items-center gap-[8px] rounded-[11px] border-0 bg-black/[0.06] px-[14px] text-[13.5px] font-[500] text-text-primary transition-colors hover:bg-black/[0.1] dark:bg-white/[0.1] dark:hover:bg-white/[0.15]"
            >
              <DiscordFill size={16} />
              {t("settings.pro.approval_button")}
            </button>
          </div>
        </div>
      )}

      {/* ── Benefits ── */}
      <div className="flex flex-col gap-[10px]">
        <p
          className="m-0 text-[13px] font-[600] text-text-primary"
          style={font}
        >
          {t("settings.pro.benefits_title")}
        </p>
        <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2">
          {BENEFITS.map((benefit) => (
            <div
              key={benefit.id}
              data-testid={`pro-benefit-${benefit.id}`}
              className="flex items-start gap-[12px] rounded-[16px] bg-black/[0.04] p-[14px] dark:bg-white/[0.06]"
            >
              <span className="flex size-[36px] shrink-0 items-center justify-center rounded-[11px] bg-amber-400/[0.16] text-amber-500 dark:text-amber-300">
                {benefit.icon}
              </span>
              <span className="flex min-w-0 flex-col gap-[3px]">
                <span
                  className="text-[13.5px] font-[600] leading-snug text-text-primary"
                  style={font}
                >
                  {t(benefit.titleKey)}
                </span>
                <span
                  className="text-[12.5px] leading-snug text-text-secondary"
                  style={font}
                >
                  {t(benefit.descKey)}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Support ── */}
      <div className="flex flex-col gap-[10px] rounded-[16px] bg-black/[0.04] p-[16px] dark:bg-white/[0.06]">
        <div className="flex flex-col gap-[2px]">
          <span
            className="text-[13px] font-[600] text-text-primary"
            style={font}
          >
            {t("settings.pro.support_title")}
          </span>
          <span
            className="text-[12.5px] leading-snug text-text-secondary"
            style={font}
          >
            {t("settings.pro.support_desc")}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-[8px]">
          <button
            type="button"
            onClick={() => openUrl("https://t.me/liner_app")}
            className="flex h-[38px] cursor-pointer items-center gap-[8px] rounded-[11px] border-0 bg-black/[0.05] px-[14px] text-[14px] font-[500] text-text-primary transition-colors hover:bg-black/[0.08] dark:bg-white/[0.08] dark:hover:bg-white/[0.12]"
          >
            <TelegramFill size={17} />
            {t("settings.about.telegram")}
          </button>
          <button
            type="button"
            onClick={() => openUrl("https://discord.gg/liner")}
            className="flex h-[38px] cursor-pointer items-center gap-[8px] rounded-[11px] border-0 bg-black/[0.05] px-[14px] text-[14px] font-[500] text-text-primary transition-colors hover:bg-black/[0.08] dark:bg-white/[0.08] dark:hover:bg-white/[0.12]"
          >
            <DiscordFill size={17} />
            {t("settings.about.discord")}
          </button>
        </div>
      </div>
    </div>
  );
}
