import { SidebarMinimalistic } from "@solar-icons/react";
import { useTranslation } from "@/languages";
import { useSidebarCollapseStore } from "../store/sidebarCollapseStore";

/**
 * The sidebar collapse toggle (the rounded panel glyph from the reference
 * screenshot): expanded shows the icon rail, pressing it again restores the
 * full sidebar. Lives in the brand row of the sidebar header — visible in
 * both states so the rail is never a dead end.
 */
export function SidebarCollapseButton() {
  const { t } = useTranslation();
  const collapsed = useSidebarCollapseStore((state) => state.collapsed);
  const toggleCollapsed = useSidebarCollapseStore(
    (state) => state.toggleCollapsed,
  );

  const label = collapsed
    ? t("common.sidebar.expand") || "Expand sidebar"
    : t("common.sidebar.collapse") || "Collapse sidebar";

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={collapsed}
      title={label}
      onClick={toggleCollapsed}
      data-no-window-drag
      className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-text-secondary transition-colors duration-150 hover:bg-fill hover:text-text-primary cursor-pointer active:scale-[0.96]"
    >
      <SidebarMinimalistic size={18} weight="Outline" />
    </button>
  );
}
