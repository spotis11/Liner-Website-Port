import { forwardRef, memo } from "react";
import { Link } from "react-router-dom";
import logo from "@/assets/logo.svg";
import { cn } from "@/shared/lib";
import { HistoryNavIsland } from "./HistoryNavIsland";

export interface HeaderProps {
  searchOpen?: boolean;
  onSearchToggle?: () => void;
  className?: string;
}

export const Header = forwardRef<HTMLElement, HeaderProps>(function Header(
  { className },
  ref,
) {
  return (
    <header
      ref={ref}
      data-window-drag
      className={cn(
        "relative z-45 w-full shrink-0 select-none bg-transparent h-[50px] flex items-center justify-between",
        className,
      )}
    >
      <div className="w-[58px] h-full flex items-center justify-center shrink-0">
        <Link
          to="/"
          data-no-window-drag
          title="Liner"
          className="flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
        >
          <img
            src={logo}
            alt="Liner"
            width={39}
            height={30}
            className="h-[30px] w-auto object-contain theme-logo invert dark:invert-0 select-none"
            draggable={false}
          />
        </Link>
      </div>

      <div className="flex items-center gap-[8px] mr-[6px] shrink-0">
        <HistoryNavIsland />
      </div>
    </header>
  );
});

export default memo(Header);
