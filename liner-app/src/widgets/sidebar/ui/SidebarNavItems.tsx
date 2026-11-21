import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { sidebarNavItems } from "@/features/navigation/data/navigation";
import { useChangelogStore } from "@/features/changelog";
import { useTranslation } from "@/languages";
import { cn } from "@/shared/lib";
import { useOfflineModeStore } from "@/features/connectivity";

export interface SidebarNavItemsProps {
  searchOpen: boolean;
  onSearchToggle: () => void;
  /** collapsed rail: icons only, labels hidden (title tooltip instead) */
  collapsed?: boolean;
}

const ROW_CLASS =
  "group flex h-[36px] shrink-0 items-center gap-[12px] px-[10px] rounded-control text-label font-[500] transition-colors duration-150 cursor-pointer select-none";

export function SidebarNavItems({
  searchOpen,
  onSearchToggle,
  collapsed = false,
}: SidebarNavItemsProps) {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const offline = useOfflineModeStore((state) => state.offline);
  // website: the changelog is a modal (like the classic sidebar), not a route
  const toggleChangelog = useChangelogStore((state) => state.toggleOpen);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  const isRouteActive = (href: string) => {
    if (pendingHref) return href === pendingHref;
    if (href === "/") {
      return pathname === "/" || pathname === "/home";
    }
    return pathname === href || pathname?.startsWith(`${href}/`);
  };

  const isItemActive = (id: string, href?: string) => {
    if (id === "search") {
      return searchOpen;
    }
    return href ? isRouteActive(href) : false;
  };

  return (
    <nav className="mt-[10px] flex shrink-0 flex-col gap-[2px] px-[8px]">
      {sidebarNavItems
        .filter((item) => item.id !== "settings")
        .filter((item) => !offline || item.id === "library")
        .map((item) => {
          const active = isItemActive(item.id, item.href);
          const Icon = item.Icon;
          const label = t(`common.sidebar.${item.id}`) || item.label;
          // collapsed rail keeps the rows tappable and accessible but
          // trades the text for a native tooltip
          const tooltipProps = collapsed
            ? ({ title: label, "aria-label": label } as const)
            : {};
          const rowShape = cn(
            ROW_CLASS,
            collapsed && "justify-center gap-0 px-0",
          );

          if (item.id === "search") {
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={searchOpen}
                onClick={onSearchToggle}
                {...tooltipProps}
                className={cn(
                  rowShape,
                  "border-0 bg-transparent w-full",
                  active
                    ? "bg-fill text-text-primary"
                    : "text-text-secondary hover:bg-fill-subtle hover:text-text-primary",
                )}
              >
                <Icon size={20} className="shrink-0" />
                {!collapsed && (
                  <span className="min-w-0 flex-1 truncate text-left">
                    {label}
                  </span>
                )}
                {!collapsed && (
                  <span
                    className="shrink-0 rounded-[6px] bg-fill-strong px-[6px] py-[2px] text-[11px] font-[500] leading-none text-text-tertiary"
                  >
                    Ctrl K
                  </span>
                )}
              </button>
            );
          }

          if (item.id === "changelog" || !item.href) {
            // website: changelog (and any href-less item) opens a modal or
            // no-ops — never a Link, whose `to` would be undefined
            return (
              <button
                key={item.id}
                type="button"
                onClick={item.id === "changelog" ? toggleChangelog : undefined}
                {...tooltipProps}
                className={cn(
                  rowShape,
                  "border-0 bg-transparent w-full",
                  "text-text-secondary hover:bg-fill-subtle hover:text-text-primary",
                )}
              >
                <Icon size={20} className="shrink-0" />
                {!collapsed && (
                  <span className="min-w-0 flex-1 truncate text-left">
                    {label}
                  </span>
                )}
              </button>
            );
          }

          return (
            <Link
              key={item.id}
              to={item.href!}
              aria-current={active ? "page" : undefined}
              onPointerDown={(event) => {
                if (event.button === 0) setPendingHref(item.href!);
              }}
              onPointerLeave={(event) => {
                if (event.buttons & 1) setPendingHref(null);
              }}
              onPointerCancel={() => setPendingHref(null)}
              {...tooltipProps}
              className={cn(
                rowShape,
                "no-underline",
                active
                  ? "bg-fill-strong text-text-primary"
                  : "text-text-secondary hover:bg-fill-subtle hover:text-text-primary",
              )}
            >
              <Icon size={20} className="shrink-0" />
              {!collapsed && (
                <span className="min-w-0 flex-1 truncate">{label}</span>
              )}
            </Link>
          );
        })}
    </nav>
  );
}
