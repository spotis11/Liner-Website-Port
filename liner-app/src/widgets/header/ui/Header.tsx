import { forwardRef, memo } from "react";
import { motion } from "framer-motion";
import { Search3Line } from "@mingcute/react";
import { cn } from "@/shared/lib";
import { useTranslation } from "@/languages";
import { HistoryNavIsland } from "./HistoryNavIsland";

export interface HeaderProps {
  searchOpen?: boolean;
  onSearchToggle?: () => void;
  className?: string;
}

export const Header = forwardRef<HTMLElement, HeaderProps>(function Header(
  { searchOpen, onSearchToggle, className },
  ref,
) {
  const { t } = useTranslation();

  return (
    <header
      ref={ref}
      data-window-drag
      className={cn(
        "relative z-45 w-full shrink-0 select-none bg-transparent h-[50px] flex items-center justify-between px-[10px] gap-[12px]",
        className,
      )}
    >
      <HistoryNavIsland />

      {/* centred search pill: opens the global search popup */}
      <button
        type="button"
        data-no-window-drag
        onClick={onSearchToggle}
        className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 flex items-center gap-[10px] h-[36px] w-[min(560px,44vw)] px-[14px] rounded-[10px] bg-fill border-0 cursor-pointer transition-colors duration-150 hover:bg-fill-hover active:scale-[0.99] text-left"
      >
        <Search3Line
          size={17}
          className={cn(
            "shrink-0",
            searchOpen ? "text-text-primary" : "text-text-tertiary",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-body text-text-tertiary font-[400]">
          {t("common.search_placeholder")}
        </span>
        <span
          data-header-kbd
          className="shrink-0 rounded-[6px] bg-fill-strong px-[7px] py-[3px] text-[11px] font-[500] leading-none text-text-tertiary"
        >
          Ctrl K
        </span>
      </button>

    </header>
  );
});

export default memo(Header);
