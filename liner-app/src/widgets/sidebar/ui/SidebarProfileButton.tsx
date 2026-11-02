import { useTranslation } from "@/languages";
import { useModalStore } from "@/features/library/store/modalStore";
import { useAuthStore } from "@/features/auth/store/authStore";
import { Tooltip, UserAvatar } from "@/shared/ui";
import { cn } from "@/shared/lib";

export function SidebarProfileButton() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const settingsOpen = useModalStore((state) => state.settingsOpen);
  const openSettingsTo = useModalStore((state) => state.openSettingsTo);

  // "Profile" replaced the old settings spot at the bottom of the sidebar:
  // it opens the settings modal straight onto the Account tab.
  const tooltipLabel = t("common.sidebar.profile") || "Profile";

  return (
    <Tooltip content={tooltipLabel} side="right" sideOffset={12}>
      <button
        type="button"
        aria-label={tooltipLabel}
        aria-pressed={settingsOpen}
        onClick={() => openSettingsTo("Account")}
        className="group relative inline-flex items-center justify-center bg-transparent border-0 p-0 cursor-pointer active:scale-[0.96] transition-transform duration-100"
      >
        <UserAvatar
          user={user ?? null}
          size={30}
          className={cn(
            "transition-opacity duration-150 ease-out",
            settingsOpen ? "opacity-100" : "opacity-80 group-hover:opacity-100",
          )}
        />
      </button>
    </Tooltip>
  );
}
