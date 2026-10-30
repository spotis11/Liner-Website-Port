import type { ReactNode } from "react";
import {
  GithubFill,
  DiscordFill,
} from "@mingcute/react";
import { useTranslation } from "@/languages";

interface AboutLink {
  id: string;
  url: string;
  label: string;
  icon: ReactNode;
}

const openUrl = (url: string) =>
  window.open(url, "_blank", "noopener,noreferrer");

export function AboutTabLinks() {
  const { t } = useTranslation();

  const links: AboutLink[] = [
    {
      id: "github",
      url: "https://github.com/goodbyeworld42-ai/Liner-Website-Port",
      label: t("settings.about.github"),
      icon: <GithubFill size={17} />,
    },
    {
      id: "discord_liner",
      url: "https://discord.com/invite/liner",
      label: t("settings.about.discord_liner"),
      icon: <DiscordFill size={17} />,
    },
    {
      id: "discord_jayjoice",
      url: "https://discord.gg/ZhSKNj9KfF",
      label: t("settings.about.discord_jayjoice"),
      icon: <DiscordFill size={17} />,
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-[8px]">
      {links.map((link) => (
        <button
          key={link.id}
          type="button"
          onClick={() => openUrl(link.url)}
          className="flex h-[38px] items-center gap-[8px] rounded-[11px] border-0 bg-black/[0.05] px-[14px] text-[14px] font-[500] text-text-primary transition-colors hover:bg-black/[0.08] dark:bg-white/[0.08] dark:hover:bg-white/[0.12]"
        >
          {link.icon}
          {link.label}
        </button>
      ))}
    </div>
  );
}
