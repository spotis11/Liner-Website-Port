import { sidebarNavItems } from "@/features/navigation/data/navigation";
import { useTranslation } from "@/languages";
import { useModalStore } from "@/features/library";
import { cn } from "@/shared/lib";

export function SidebarSettingsButton() {
  const { t } = useTranslation();
  const settingsOpen = useModalStore((state) => state.settingsOpen);
  const toggleSettings = useModalStore((state) => state.toggleSettings);

  const settingsItem = sidebarNavItems.find((item) => item.id === "settings");
  if (!settingsItem) return null;

  const Icon = settingsItem.Icon;
  const ariaLabel = t("common.sidebar.settings") || settingsItem.label;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={settingsOpen}
      title={ariaLabel}
      onClick={toggleSettings}
      className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-text-secondary transition-colors duration-150 hover:bg-fill hover:text-text-primary cursor-pointer active:scale-[0.96]"
    >
      <Icon
        size={16}
        className={cn(
          "relative z-10",
          settingsOpen ? "text-text-primary" : "",
        )}
      />
    </button>
  );
}
