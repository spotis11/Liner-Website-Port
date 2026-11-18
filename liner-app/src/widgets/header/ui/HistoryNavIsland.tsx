import { LeftLine, RightLine } from "@mingcute/react";
import { useTranslation } from "@/languages";
import { cn } from "@/shared/lib";
import { useHistoryNavigation } from "../lib/useHistoryNavigation";

const NAV_BUTTON_CLASS =
  "flex w-[28px] h-[28px] items-center justify-center rounded-control border-0 bg-transparent p-0 cursor-pointer select-none text-text-secondary transition-[background-color,color,opacity] duration-150 hover:bg-fill hover:text-text-primary active:scale-95 disabled:!opacity-25 disabled:hover:bg-transparent disabled:cursor-default disabled:pointer-events-none";

export interface HistoryNavIslandProps {
  className?: string;
}

export function HistoryNavIsland({ className }: HistoryNavIslandProps) {
  const { t } = useTranslation();
  const { canGoBack, canGoForward, goBack, goForward } = useHistoryNavigation();

  return (
    <div
      data-no-window-drag
      data-no-tooltip="true"
      className={cn(
        "flex items-center gap-[4px] shrink-0 bg-transparent",
        className,
      )}
    >
      <button
        type="button"
        onClick={goBack}
        disabled={!canGoBack}
        aria-label={t("common.back")}
        className={NAV_BUTTON_CLASS}
      >
        <LeftLine size={18} />
      </button>
      <button
        type="button"
        onClick={goForward}
        disabled={!canGoForward}
        aria-label={t("common.forward")}
        className={NAV_BUTTON_CLASS}
      >
        <RightLine size={18} />
      </button>
    </div>
  );
}
