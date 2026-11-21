import { memo } from "react";
import { Link } from "react-router-dom";
import logo from "@/assets/logo.svg";
import { useAuthStore } from "@/features/auth";
import { cn } from "@/shared/lib";
import { useSidebarCollapseStore } from "../store/sidebarCollapseStore";
import { SidebarCollapseButton } from "./SidebarCollapseButton";
import { SidebarLibrary } from "./SidebarLibrary";
import { SidebarNavItems } from "./SidebarNavItems";
import { SidebarSettingsButton } from "./SidebarSettingsButton";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + second).toUpperCase() || "L";
}

function Sidebar({ searchOpen, onSearchToggle }: SidebarProps) {
  const user = useAuthStore((state) => state.user);
  const collapsed = useSidebarCollapseStore((state) => state.collapsed);

  return (
    <div className="h-full w-full flex flex-col pt-[4px] pb-[4px] min-h-0">
      {/* brand — the collapse toggle sits at the end of this row in both
          states, so the rail is never a dead end (reference screenshot);
          collapsed, the logo + toggle pair centers over the icon column */}
      <div
        className={cn(
          "flex items-center px-[8px] h-[42px] shrink-0",
          collapsed ? "justify-center gap-[4px]" : "gap-[6px]",
        )}
      >
        <Link
          to="/"
          title="Liner"
          className={cn(
            "flex min-w-0 items-center rounded-control cursor-pointer active:scale-[0.98] transition-transform",
            collapsed || "flex-1 gap-[10px]",
          )}
        >
          <img
            src={logo}
            alt="Liner"
            width={24}
            height={19}
            className="h-[19px] w-auto object-contain theme-logo invert dark:invert-0 select-none"
            draggable={false}
          />
          <span
            className={cn(
              "min-w-0 truncate text-[15px] font-[600] tracking-tight text-text-primary select-none",
              collapsed && "hidden",
            )}
          >
            Liner
          </span>
        </Link>
        <SidebarCollapseButton />
      </div>

      <SidebarNavItems
        searchOpen={searchOpen}
        onSearchToggle={onSearchToggle}
        collapsed={collapsed}
      />

      {!collapsed && <SidebarLibrary />}

      {/* account row pinned to the window bottom — stacks vertically while
          collapsed so the avatar and settings stay reachable in the rail */}
      <div
        className={cn(
          "mt-auto shrink-0 rounded-control",
          collapsed
            ? "flex flex-col items-center gap-[6px] px-[6px] py-[8px]"
            : "flex items-center gap-[10px] px-[10px] h-[46px]",
        )}
      >
        <div
          title={user?.displayName || user?.username || "Liner"}
          className="h-[28px] w-[28px] shrink-0 rounded-full overflow-hidden bg-fill-strong flex items-center justify-center"
        >
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <span className="text-[11px] font-[600] text-text-secondary">
              {initials(user?.displayName || "L")}
            </span>
          )}
        </div>
        {!collapsed && (
          <span className="min-w-0 flex-1 truncate text-label font-[500] text-text-primary select-none">
            {user?.displayName || user?.username || "Liner"}
          </span>
        )}
        <SidebarSettingsButton />
      </div>
    </div>
  );
}

export interface SidebarProps {
  searchOpen: boolean;
  onSearchToggle: () => void;
}

export default memo(Sidebar);
