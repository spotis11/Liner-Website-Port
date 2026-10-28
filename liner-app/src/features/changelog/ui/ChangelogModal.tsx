// Sidebar → Changelog modal: what was made or fixed after every update.
// Styled to match the settings modal (Dialog shell, grouped cards).

import { useMemo } from "react";
import { motion } from "framer-motion";
import { CloseLine, AddCircleFill, CheckCircleFill, Refresh2Line } from "@mingcute/react";
import Dialog from "@/shared/ui/Dialog";
import { useTranslation } from "@/languages";
import { useChangelogStore } from "../store/changelogStore";
import { CHANGELOG, type ChangelogEntryType } from "../data/changelog";

const TYPE_STYLES: Record<
  ChangelogEntryType,
  { icon: React.ComponentType<{ size?: number; className?: string }>; badgeClass: string; labelKey: string }
> = {
  added: {
    icon: AddCircleFill,
    badgeClass: "bg-[#3fae5a]/15 text-[#3fae5a]",
    labelKey: "changelog.added",
  },
  fixed: {
    icon: CheckCircleFill,
    badgeClass: "bg-[#4a90e2]/15 text-[#4a90e2]",
    labelKey: "changelog.fixed",
  },
  changed: {
    icon: Refresh2Line,
    badgeClass: "bg-[#e08c3f]/15 text-[#e08c3f]",
    labelKey: "changelog.changed",
  },
};

function formatDate(iso: string, locale: string): string {
  try {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return iso;
  }
}

export function ChangelogModal() {
  const { open, closeModal } = useChangelogStore();
  const { t, locale } = useTranslation();
  const releases = useMemo(() => CHANGELOG, []);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : closeModal())} maxWidth={480}>
      <div className="flex flex-col overflow-hidden rounded-[22px] bg-bg-panel text-text-primary">
        {/* header */}
        <div className="relative flex shrink-0 items-center justify-between px-[20px] pt-[18px] pb-[14px]">
          <div className="min-w-0">
            <h2 className="m-0 text-[18px] font-[700] leading-[1.2]">
              {t("changelog.title")}
            </h2>
            <p className="m-0 mt-[2px] text-[12px] text-text-tertiary">
              {t("changelog.subtitle")}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("changelog.close")}
            onClick={closeModal}
            className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border-none bg-border-alpha-14 text-text-secondary cursor-pointer transition-colors hover:bg-border-alpha-33 hover:text-text-primary"
          >
            <CloseLine size={16} />
          </button>
        </div>

        {/* releases */}
        <div className="flex min-h-0 flex-col gap-[14px] overflow-y-auto px-[20px] pb-[20px] max-h-[min(560px,70vh)]">
          {releases.map((release, releaseIndex) => (
            <motion.div
              key={release.version}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16, delay: Math.min(releaseIndex * 0.03, 0.12) }}
              className="rounded-2xl border border-border-alpha-14 bg-black/[0.03] p-[14px] dark:bg-white/[0.04]"
            >
              <div className="flex items-baseline gap-[8px]">
                <span className="rounded-md bg-btn-primary-bg px-[8px] py-[2px] text-[11px] font-[800] leading-[1.5] text-btn-primary-text">
                  v{release.version}
                </span>
                <span className="min-w-0 truncate text-[14px] font-[600] text-text-primary">
                  {release.title}
                </span>
                <span className="ml-auto shrink-0 text-[11px] tabular-nums text-text-tertiary">
                  {formatDate(release.date, locale)}
                </span>
              </div>

              <ul className="m-0 mt-[10px] flex list-none flex-col gap-[8px] p-0">
                {release.entries.map((entry, entryIndex) => {
                  const style = TYPE_STYLES[entry.type];
                  const Icon = style.icon;
                  return (
                    <li key={entryIndex} className="flex items-start gap-[8px]">
                      <span
                        className={`mt-[1px] inline-flex h-[18px] shrink-0 items-center gap-[4px] rounded-full px-[6px] text-[10px] font-[700] uppercase tracking-wide ${style.badgeClass}`}
                      >
                        <Icon size={10} />
                        {t(style.labelKey)}
                      </span>
                      <span className="min-w-0 flex-1 text-[12.5px] leading-[1.5] text-text-secondary">
                        {entry.text}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </motion.div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
