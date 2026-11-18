import { MenuSelect } from "@/shared/ui";
import { useTranslation, LOCALE_OPTIONS } from "@/languages";
import logo from "@/assets/logo.svg";
import { Squiggle, Sparks, Asterisk } from "@/shared/ui/Doodles";

export interface LoginBrandPanelProps {
  title: string;
  subtitle: string;
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

export function LoginBrandPanel({ title, subtitle }: LoginBrandPanelProps) {
  const { locale, setLocale, t } = useTranslation();

  // squiggle sits under the last word, like evi underlines its own name
  const lastSpace = title.lastIndexOf(" ");
  const head = lastSpace > 0 ? title.slice(0, lastSpace) : "";
  const tail = lastSpace > 0 ? title.slice(lastSpace + 1) : title;

  return (
    <aside className="relative flex min-h-[340px] flex-col overflow-hidden rounded-item bg-black/[0.03] p-[24px] dark:bg-white/[0.035]">
      {/* stacked cover cards + doodles */}
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

      <div className="relative flex items-center gap-[10px]">
        <img
          src={logo}
          alt="Liner"
          width={45}
          height={35}
          draggable={false}
          className="theme-logo h-[22px] w-auto object-contain select-none"
        />
        <span className="text-heading font-[650] tracking-[-0.03em] text-text-primary">
          Liner
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
            <Squiggle className="absolute -bottom-[7px] left-0 h-[9px] w-full text-doodle-lime" />
          </span>
        </h1>
        <p
          className="m-0 mt-[14px] max-w-[240px] text-[13.5px] leading-[1.5] text-text-secondary"
          style={{ textWrap: "pretty" }}
        >
          {subtitle}
        </p>
      </div>
    </aside>
  );
}

export default LoginBrandPanel;
