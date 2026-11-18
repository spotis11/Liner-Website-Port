import { Fragment, type ReactNode } from "react";
import { cn } from "@/shared/lib";
import ScrollableText from "./ScrollableText";

export const HERO_TITLE_CLASS =
  "font-roboto-flex-heading m-0 text-[44px] leading-[1.08] tracking-[-0.01em] text-text-primary line-clamp-2";

const HERO_SUBTITLE_TEXT =
  "m-0 text-body font-[400] leading-[1.45] text-text-secondary";

export const HERO_SUBTITLE_CLASS = `${HERO_SUBTITLE_TEXT} line-clamp-1`;

export const HERO_GLASS_CLASS = "bg-fill";

export interface HeroEyebrowProps {
  text: string;
}

/** small caps label above a hero title ("Playlist", "Album") */
export function HeroEyebrow({ text }: HeroEyebrowProps) {
  return (
    <p className="m-0 mb-[6px] text-[13px] font-[500] leading-[1.2] text-text-secondary select-none">
      {text}
    </p>
  );
}

export interface HeroSubtitleProps {
  text: string;
}

export function HeroSubtitle({ text }: HeroSubtitleProps) {
  return <ScrollableText text={text} className={HERO_SUBTITLE_TEXT} />;
}

export interface HeroMetaProps {
  items: ReactNode[];
}

/** One line of plain facts under the subtitle: "2019 · 12 tracks · 41 min". */
export function HeroMeta({ items }: HeroMetaProps) {
  const visible = items.filter(
    (item) =>
      item !== null && item !== undefined && item !== false && item !== "",
  );
  if (visible.length === 0) return null;
  return (
    <p className="m-0 flex min-w-0 flex-wrap items-center text-label font-[400] leading-[1.3] text-text-secondary select-none">
      {visible.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <span className="px-[6px]" aria-hidden>
              ·
            </span>
          )}
          <span>{item}</span>
        </Fragment>
      ))}
    </p>
  );
}

export const HERO_CHIP_CLASS =
  "inline-flex h-[26px] items-center gap-[6px] rounded-[9px] px-[11px] text-[12px] font-[400] text-text-primary select-none bg-black/[0.05] dark:bg-white/[0.1]";

export const HERO_BUTTON_CLASS =
  "!h-[40px] !rounded-full !border-0 !text-label flex items-center justify-center gap-[8px] shrink-0 !px-[22px] !font-[500]";

export const HERO_GLASS_BUTTON_CLASS =
  "!border-transparent !bg-fill hover:!bg-fill-hover";

export interface EntityHeroProps {
  cover: ReactNode;
  coverClassName?: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  trailingActions?: ReactNode;
  /** extra classes for the text column (e.g. `self-stretch` to match the cover height) */
  contentClassName?: string;
  /** extra classes for the actions row (e.g. `mt-auto` to pin it to the bottom) */
  actionsClassName?: string;
}

export function EntityHero({
  cover,
  coverClassName,
  eyebrow,
  title,
  subtitle,
  meta,
  actions,
  trailingActions,
  contentClassName,
  actionsClassName,
}: EntityHeroProps) {
  return (
    <section
      className="flex w-full min-w-0 items-stretch gap-[22px]"
      data-no-window-drag
    >
      {/* 180px cover, square with a soft radius */}
      <div
        className={cn(
          "relative flex h-[180px] w-[180px] shrink-0 items-center justify-center overflow-hidden rounded-[8px]",
          coverClassName || "bg-fill",
        )}
      >
        {cover}
      </div>

      <div className={cn("flex min-w-0 flex-1 flex-col", contentClassName)}>
        {eyebrow && <div className="min-w-0">{eyebrow}</div>}
        <div className="min-w-0">{title}</div>
        {subtitle && <div className="mt-[8px] min-w-0">{subtitle}</div>}
        {meta && <div className="mt-[10px]">{meta}</div>}

        {(actions || trailingActions) && (
          <div
            className={cn(
              // pinned to the cover's bottom edge, at least 16px under the meta
              "mt-auto pt-[16px] flex flex-wrap items-center justify-between gap-[12px]",
              actionsClassName,
            )}
          >
            <div className="flex items-center gap-[10px]">{actions}</div>
            <div className="flex items-center gap-[12px]">
              {trailingActions}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default EntityHero;
