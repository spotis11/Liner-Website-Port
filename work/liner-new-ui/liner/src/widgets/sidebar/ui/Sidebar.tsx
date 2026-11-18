import { memo } from "react";
import { Link } from "react-router-dom";
import logo from "@/assets/logo.svg";
import { useAuthStore } from "@/features/auth";
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

  return (
    <div className="h-full w-full flex flex-col pt-[4px] pb-[4px] min-h-0">
      {/* brand */}
      <Link
        to="/"
        title="Liner"
        className="flex items-center gap-[10px] px-[10px] h-[42px] shrink-0 rounded-control cursor-pointer active:scale-[0.98] transition-transform"
      >
        <img
          src={logo}
          alt="Liner"
          width={24}
          height={19}
          className="h-[19px] w-auto object-contain theme-logo invert dark:invert-0 select-none"
          draggable={false}
        />
        <span className="text-[15px] font-[600] tracking-tight text-text-primary select-none">
          Liner
        </span>
      </Link>

      <SidebarNavItems
        searchOpen={searchOpen}
        onSearchToggle={onSearchToggle}
      />

      <SidebarLibrary />

      {/* account row pinned to the window bottom */}
      <div className="mt-auto flex items-center gap-[10px] px-[10px] h-[46px] shrink-0 rounded-control">
        <div className="h-[28px] w-[28px] shrink-0 rounded-full overflow-hidden bg-fill-strong flex items-center justify-center">
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
        <span className="min-w-0 flex-1 truncate text-label font-[500] text-text-primary select-none">
          {user?.displayName || user?.username || "Liner"}
        </span>
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
