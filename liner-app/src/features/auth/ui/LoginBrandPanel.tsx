import { MenuSelect } from "@/shared/ui";
import { useTranslation, LOCALE_OPTIONS } from "@/languages";
import { useShowcaseName } from "@/features/showcase";
import { Squiggle, Sparks, Asterisk } from "@/shared/ui/Doodles";
import logo from "@/assets/logo.svg";
import loginMark from "@/assets/login-mark.svg";

export type LoginPanelVariant = "original" | "new";

export interface LoginBrandPanelProps {
  title: string;
  subtitle: string;
  /** "original" (default) = classic Liner watermark art; "new" = evi-flavored
   * redesign ported from the desktop source (stacked covers + doodles). */
  variant?: LoginPanelVariant;
}

// evi-flavored brand art: three fanned gradient covers with doodles around
const CARD_ART = [
  {
    className: "left-[100px] top-[12px] h-[102px] w-[102px] rotate-[10deg]",
    background: "linear-gradient(140deg, #6c5ce7 0%, #3425af 100%)",
  },
  {
    className: "left-[54px] top-[6px] h-[108px] w-[108px] rotate-[3deg]",
    background: "linear-gradient(150deg, #2fae8f 0%, #17604f 100%)",
  },
  {
    className: "left-0 top-[2px] h-[114px] w-[114px] rotate-[-7deg]",
    background:
      "radial-gradient(120% 120% at 30% 20%, #e89aff 0%, #b0326a 45%, #532654 100%)",
  },
];

export function LoginBrandPanel({
  title,
  subtitle,
  variant = "original",
}: LoginBrandPanelProps) {
  const { locale, setLocale, t } = useTranslation();
  // Website Showcase mode: scrambles into random letters while it is on
  const siteName = useShowcaseName();

  const isNew = variant === "new";

  // squiggle sits under the last word, like evi underlines its own name
  const lastSpace = title.lastIndexOf(" ");
  const head = isNew && lastSpace > 0 ? title.slice(0, lastSpace) : "";
  const tail = isNew && lastSpace > 0 ? title.slice(lastSpace + 1) : title;

  return (
    <aside className="relative flex min-h-[340px] flex-col overflow-hidden rounded-[14px] bg-black/[0.03] p-[24px] dark:bg-white/[0.035]">
      {isNew ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-[18px] top-[16px] hidden h-[132px] w-[240px] select-none sm:block"
        >
          {CARD_ART.map((card, index) => (
            <div
              key={index}
              className={`absolute rounded-[20px] shadow-[0_10px_30px_rgba(0,0,0,0.35)] ${card.className}`}
              style={{ background: card.background }}
            />
          ))}
          <Sparks className="absolute right-[4px] top-[-6px] h-[32px] w-[42px] rotate-[12deg] text-doodle-lime" />
          <Asterisk className="absolute bottom-[6px] left-[40px] h-[28px] w-[28px] rotate-[-14deg] text-doodle-orange" />
        </div>
      ) : (
        <>
          <img
            src={loginMark}
            alt=""
            aria-hidden="true"
            width={435}
            height={598}
            draggable={false}
            className="theme-logo pointer-events-none absolute inset-x-0 top-0 h-auto w-full select-none mask-b-from-40% mask-b-to-100%"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[60%] bg-linear-to-t from-transparent to-transparent dark:from-black/25" />
        </>
      )}

      <div className="relative flex items-center gap-[10px]">
        <img
          src={logo}
          alt="Liner"
          width={45}
          height={35}
          draggable={false}
          className="theme-logo h-[22px] w-auto object-contain select-none"
        />
        <span className="text-[18px] font-[650] tracking-[-0.03em] text-text-primary">
          {siteName}
        </span>
      </div>

      <div className="relative mt-auto flex flex-col">
        <div className="mb-[22px] w-fit">
          <MenuSelect
            options={LOCALE_OPTIONS}
            value={locale}
            onChange={setLocale}
            align="start"
            className="min-w-[132px]"
            aria-label={t("login.select_language")}
          />
        </div>
        <h1
          className="m-0 text-[30px] font-[700] leading-[1.08] tracking-[-0.035em] text-text-primary"
          style={{ textWrap: "balance" }}
        >
          {head}{" "}
          <span className="relative inline-block">
            {tail}
            {isNew && (
              <Squiggle className="absolute -bottom-[7px] left-0 h-[9px] w-full text-doodle-lime" />
            )}
          </span>
        </h1>
        <p
          className="m-0 mt-[10px] max-w-[240px] text-[13.5px] leading-[1.5] text-text-secondary"
          style={{ textWrap: "pretty" }}
        >
          {subtitle}
        </p>
      </div>
    </aside>
  );
}

export default LoginBrandPanel;
