import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import {
  CloseLine,
  Search2Line,
  CloseCircleFill,
  ExitLine,
  KeyboardLine,
  User3Line,
  YoutubeFill,
  AnnouncementLine,
  ForbidCircleLine,
  UserSearchLine,
} from "@mingcute/react";
import {
  Play,
  Palette,
  InfoCircle,
  Book2,
  QuestionCircle,
  Database,
  Widget5,
  Gallery,
  Translation,
} from "@solar-icons/react";
import Dialog from "@/shared/ui/Dialog";
import { UserAvatar } from "@/shared/ui";
import { useScrollFade } from "@/shared/hooks";
import { useTranslation, getTranslationsForAllLocales } from "@/languages";
import { useModalStore } from "@/features/library";
import { useAuthStore } from "@/features/auth";
import { userDisplayName } from "@/entities/user";
import {
  PlaybackTab,
  ShortcutsTab,
  AppearanceTab,
  CustomizationTab,
  StorageTab,
  AboutTab,
  OverlayTab,
  YoutubeTab,
  AccountTab,
  AnnouncementTab,
  UserFinderTab,
  ModerationTab,
} from "./tabs";
import { AiTranslateSettingsTab } from "@/features/lyrics";
import { isWebsiteAdmin } from "@/features/announcements";

type TabId =
  | "Account"
  | "Playback"
  | "Shortcuts"
  | "Overlay"
  | "Youtube"
  | "AiTranslate"
  | "Appearance"
  | "Customization"
  | "Storage"
  | "About"
  | "Announcement"
  | "UserFinder"
  | "Moderation";

const navGroupClass =
  "flex flex-col gap-[1px] rounded-[14px] bg-bg-surface/70 p-[4px] dark:bg-white/[0.06]";

const TAB_ICONS: Record<TabId, React.ComponentType<any>> = {
  Account: User3Line,
  Playback: Play,
  Shortcuts: KeyboardLine,
  Overlay: Widget5,
  Youtube: YoutubeFill,
  AiTranslate: Translation,
  Appearance: Palette,
  Customization: Gallery,
  Storage: Database,
  About: InfoCircle,
  Announcement: AnnouncementLine,
  UserFinder: UserSearchLine,
  Moderation: ForbidCircleLine,
};

type TabGroupKey =
  | "account"
  | "player"
  | "interface"
  | "integrations"
  | "application"
  | "website";

const TAB_GROUPS: { labelKey: TabGroupKey; ids: TabId[] }[] = [
  { labelKey: "account", ids: ["Account"] },
  { labelKey: "player", ids: ["Playback", "Shortcuts"] },
  { labelKey: "interface", ids: ["Appearance", "Customization", "Overlay"] },
  { labelKey: "integrations", ids: ["Youtube", "AiTranslate"] },
  { labelKey: "application", ids: ["Storage", "About"] },
  // website-port group: only visible to the site owner (see visibleGroups)
  { labelKey: "website", ids: ["Announcement", "UserFinder", "Moderation"] },
];

const WEBSITE_GROUP_LABEL_KEY: TabGroupKey = "website";

const SETTING_ITEMS: { tabId: TabId; titleKey: string; descKey?: string }[] = [
  // Account
  {
    tabId: "Account",
    titleKey: "settings.profile.details_section",
    descKey: "settings.profile.details_subtitle",
  },
  {
    tabId: "Account",
    titleKey: "settings.profile.display_name_label",
    descKey: "settings.profile.display_name_placeholder",
  },
  {
    tabId: "Account",
    titleKey: "settings.profile.username_label",
    descKey: "settings.profile.username_hint",
  },
  {
    tabId: "Account",
    titleKey: "settings.profile.bio_label",
    descKey: "settings.profile.bio_placeholder",
  },
  {
    tabId: "Account",
    titleKey: "settings.profile.avatar_change",
    descKey: "settings.profile.avatar_remove",
  },
  {
    tabId: "Account",
    titleKey: "settings.profile.public_profile.title",
    descKey: "settings.profile.public_profile.description",
  },
  {
    tabId: "Account",
    titleKey: "settings.profile.show_activity.title",
    descKey: "settings.profile.show_activity.description",
  },
  {
    tabId: "Account",
    titleKey: "settings.profile.show_history.title",
    descKey: "settings.profile.show_history.description",
  },
  {
    tabId: "Account",
    titleKey: "settings.profile.show_liked_tracks.title",
    descKey: "settings.profile.show_liked_tracks.description",
  },
  {
    tabId: "Account",
    titleKey: "settings.profile.participate_leaderboards.title",
    descKey: "settings.profile.participate_leaderboards.description",
  },
  {
    tabId: "Account",
    titleKey: "settings.profile.change_password",
    descKey: "settings.profile.password_note",
  },

  // Playback
  {
    tabId: "Playback",
    titleKey: "settings.hover_preview.title",
    descKey: "settings.hover_preview.description",
  },
  {
    tabId: "Playback",
    titleKey: "settings.autoplay_similar.title",
    descKey: "settings.autoplay_similar.description",
  },
  {
    tabId: "Playback",
    titleKey: "settings.track_double_click.title",
    descKey: "settings.track_double_click.description",
  },
  {
    tabId: "Playback",
    titleKey: "settings.default_playback_context.title",
    descKey: "settings.default_playback_context.description",
  },
  {
    tabId: "Playback",
    titleKey: "settings.audio.pause_on_device_change.title",
    descKey: "settings.audio.pause_on_device_change.description",
  },

  // Shortcuts
  {
    tabId: "Shortcuts",
    titleKey: "settings.shortcuts.global_section",
    descKey: "settings.shortcuts.global_desc",
  },
  {
    tabId: "Shortcuts",
    titleKey: "settings.shortcuts.main_app_section",
    descKey: "settings.shortcuts.main_app_desc",
  },
  {
    tabId: "Shortcuts",
    titleKey: "settings.shortcuts.miniplayer_section",
    descKey: "settings.shortcuts.miniplayer_desc",
  },
  {
    tabId: "Shortcuts",
    titleKey: "settings.shortcuts.toggle_overlay",
    descKey: "settings.shortcuts.toggle_overlay_desc",
  },
  {
    tabId: "Shortcuts",
    titleKey: "settings.shortcuts.quick_like_song",
    descKey: "settings.shortcuts.quick_like_song_desc",
  },
  {
    tabId: "Shortcuts",
    titleKey: "settings.shortcuts.play_pause",
    descKey: "settings.shortcuts.play_pause_desc",
  },
  {
    tabId: "Shortcuts",
    titleKey: "settings.shortcuts.next_track",
    descKey: "settings.shortcuts.next_track_desc",
  },
  {
    tabId: "Shortcuts",
    titleKey: "settings.shortcuts.prev_track",
    descKey: "settings.shortcuts.prev_track_desc",
  },
  {
    tabId: "Shortcuts",
    titleKey: "settings.shortcuts.like_track",
    descKey: "settings.shortcuts.like_track_desc",
  },

  // Overlay
  {
    tabId: "Overlay",
    titleKey: "settings.overlay.position.title",
    descKey: "settings.overlay.position.description",
  },
  {
    tabId: "Overlay",
    titleKey: "settings.overlay.show_lyrics.title",
    descKey: "settings.overlay.show_lyrics.description",
  },
  {
    tabId: "Overlay",
    titleKey: "settings.overlay.auto_show_on_minimize.title",
    descKey: "settings.overlay.auto_show_on_minimize.description",
  },
  {
    tabId: "Overlay",
    titleKey: "settings.overlay.always_on_top.title",
    descKey: "settings.overlay.always_on_top.description",
  },

  // Integrations
  {
    tabId: "Youtube",
    titleKey: "settings.youtube.account_playback.title",
    descKey: "settings.youtube.account_playback.description",
  },
  {
    tabId: "Youtube",
    titleKey: "settings.youtube.prompt_sign_in.title",
    descKey: "settings.youtube.prompt_sign_in.description",
  },
  {
    tabId: "Youtube",
    titleKey: "settings.youtube.sync_library.title",
    descKey: "settings.youtube.sync_library.description",
  },

  // Appearance
  {
    tabId: "Appearance",
    titleKey: "settings.language.label",
    descKey: "settings.language.description",
  },
  {
    tabId: "Appearance",
    titleKey: "settings.appearance.same_as_device_title",
    descKey: "settings.appearance.same_as_device_description",
  },
  {
    tabId: "Appearance",
    titleKey: "settings.appearance.color_themes_title",
    descKey: "settings.appearance.color_themes_description",
  },
  {
    tabId: "Appearance",
    titleKey: "settings.cover_glow.title",
    descKey: "settings.cover_glow.description",
  },
  {
    tabId: "Customization",
    titleKey: "settings.customization.wallpaper_title",
    descKey: "settings.customization.wallpaper_description",
  },
  {
    tabId: "Customization",
    titleKey: "settings.customization.blocks_title",
    descKey: "settings.customization.blocks_description",
  },
  {
    tabId: "Customization",
    titleKey: "settings.customization.reset_all",
    descKey: "settings.customization.reset_all_desc",
  },

  // Storage
  {
    tabId: "Storage",
    titleKey: "settings.storage.title",
    descKey: "settings.storage.description",
  },
  { tabId: "Storage", titleKey: "settings.storage.usage_title" },
  {
    tabId: "Storage",
    titleKey: "settings.storage.open_folder",
    descKey: "settings.storage.open_folder_description",
  },

  // About
  {
    tabId: "About",
    titleKey: "settings.about.liner",
    descKey: "common.app.version",
  },
  { tabId: "About", titleKey: "settings.notifications.test_button" },
];

// searchable entries for the website-owner-only Announcement tab
const ANNOUNCEMENT_SEARCH_ITEMS: { tabId: TabId; titleKey: string; descKey?: string }[] = [
  {
    tabId: "Announcement",
    titleKey: "settings.announcement.section_title",
    descKey: "settings.announcement.section_subtitle",
  },
  {
    tabId: "Announcement",
    titleKey: "settings.announcement.message_label",
    descKey: "settings.announcement.message_placeholder",
  },
];

// searchable entries for the website-owner-only User Finder tab
const USER_FINDER_SEARCH_ITEMS: { tabId: TabId; titleKey: string; descKey?: string }[] = [
  {
    tabId: "UserFinder",
    titleKey: "settings.user_finder.title",
    descKey: "settings.user_finder.description",
  },
  {
    tabId: "UserFinder",
    titleKey: "settings.user_finder.recent_songs",
  },
];

// searchable entries for the website-owner-only Moderation (bans) tab
const MODERATION_SEARCH_ITEMS: { tabId: TabId; titleKey: string; descKey?: string }[] = [
  {
    tabId: "Moderation",
    titleKey: "settings.moderation.section_title",
    descKey: "settings.moderation.section_subtitle",
  },
  {
    tabId: "Moderation",
    titleKey: "settings.moderation.ban_title",
    descKey: "settings.moderation.ban_hint",
  },
  {
    tabId: "Moderation",
    titleKey: "settings.moderation.unban_title",
    descKey: "settings.moderation.unban_hint",
  },
];

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

export default function SettingsModal() {
  const { t } = useTranslation();
  const open = useModalStore((state) => state.settingsOpen);
  const close = useModalStore((state) => state.closeSettings);
  const requestedTab = useModalStore((state) => state.settingsRequestedTab);
  const consumeSettingsRequestedTab = useModalStore(
    (state) => state.consumeSettingsRequestedTab,
  );

  const [activeTab, setActiveTab] = useState<TabId>("Account");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  // The sidebar Profile button (and other deep links) can request a tab:
  // honor it whenever the modal opens, then clear the request.
  useEffect(() => {
    if (!open || !requestedTab) return;
    const validTabs = TAB_GROUPS.flatMap((group) => group.ids);
    if ((validTabs as string[]).includes(requestedTab)) {
      setActiveTab(requestedTab as TabId);
    }
    consumeSettingsRequestedTab();
  }, [open, requestedTab, consumeSettingsRequestedTab]);

  // website-port owner gate: the Announcement and Moderation tabs exist only for @jayzeyluna
  const authUser = useAuthStore((state) => state.user);
  const isAdmin = isWebsiteAdmin(authUser?.username);
  const visibleGroups = useMemo(
    () =>
      isAdmin
        ? TAB_GROUPS
        : TAB_GROUPS.filter((group) => group.labelKey !== WEBSITE_GROUP_LABEL_KEY),
    [isAdmin],
  );
  const searchableItems = useMemo(
    () =>
      isAdmin
        ? [...SETTING_ITEMS, ...ANNOUNCEMENT_SEARCH_ITEMS, ...USER_FINDER_SEARCH_ITEMS, ...MODERATION_SEARCH_ITEMS]
        : SETTING_ITEMS,
    [isAdmin],
  );
  const {
    attach: attachNavFade,
    onScroll: onNavScroll,
    style: navFadeStyle,
  } = useScrollFade<HTMLElement>();
  const searchCentered = !searchQuery && !searchFocused;

  const handleClose = () => {
    setSearchQuery("");
    close();
  };

  const tabLabels: Record<TabId, string> = {
    Account: t("settings.tabs.account") || "Account",
    Playback: t("settings.tabs.playback"),
    Shortcuts: t("settings.tabs.shortcuts") || "Shortcuts",
    Overlay: t("settings.tabs.overlay") || "Overlay",
    Youtube: t("settings.tabs.youtube") || "YouTube",
    AiTranslate: t("settings.tabs.ai_translate") || "AI Translate",
    Appearance: t("settings.tabs.appearance"),
    Customization: t("settings.tabs.customization") || "Customization",
    Storage: t("settings.tabs.storage"),
    About: t("settings.tabs.about"),
    Announcement: t("settings.tabs.announcement") || "Announcement",
    UserFinder: t("settings.user_finder.title") || "User Finder",
    Moderation: t("settings.tabs.moderation") || "Moderation",
  };

  const tabDescriptions: Record<TabId, string> = {
    Account:
      t("settings.profile.description") ||
      "Update your public profile, avatar and privacy preferences.",
    Playback: t("settings.playback.description"),
    Shortcuts:
      t("settings.shortcuts.description") ||
      "System-wide and player keyboard shortcuts.",
    Overlay:
      t("settings.overlay.description") ||
      "Desktop overlay behavior, position and lyrics display.",
    Youtube:
      t("settings.youtube.description") ||
      "Sign in to your YouTube account to prevent playback errors.",
    AiTranslate:
      t("settings.ai_translate.description") ||
      "Translate lyrics with AI providers or Google Translate.",
    Appearance: t("settings.theme.description"),
    Customization:
      t("settings.customization.description") ||
      "Window background wallpaper, transparency and block blur effects.",
    Storage: t("settings.storage.description"),
    About: t("settings.about.tagline"),
    Announcement:
      t("settings.announcement.description") ||
      "Broadcast a message to everyone on the website.",
    UserFinder: t("settings.user_finder.description"),
    Moderation:
      t("settings.moderation.description") ||
      "Ban accounts from this website and lift bans again.",
  };

  const matchingTabIds = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const query = searchQuery.toLowerCase().trim();
    const set = new Set<TabId>();

    const TAB_LABEL_KEYS: Partial<Record<TabId, string>> = {
      Account: "settings.tabs.account",
      Playback: "settings.tabs.playback",
      Shortcuts: "settings.tabs.shortcuts",
      Overlay: "settings.tabs.overlay",
      Youtube: "settings.tabs.youtube",
      AiTranslate: "settings.tabs.ai_translate",
      Appearance: "settings.theme.title",
      Customization: "settings.tabs.customization",
      Storage: "settings.tabs.storage",
      About: "settings.tabs.about",
      ...(isAdmin ? { Announcement: "settings.tabs.announcement" } : {}),
      ...(isAdmin ? { Moderation: "settings.tabs.moderation" } : {}),
    };

    const TAB_DESC_KEYS: Partial<Record<TabId, string>> = {
      Account: "settings.profile.description",
      Playback: "settings.playback.description",
      Shortcuts: "settings.shortcuts.description",
      Overlay: "settings.overlay.description",
      Youtube: "settings.youtube.description",
      AiTranslate: "settings.ai_translate.description",
      Appearance: "settings.theme.description",
      Customization: "settings.customization.description",
      Storage: "settings.storage.description",
      About: "settings.about.tagline",
      ...(isAdmin
        ? { Announcement: "settings.announcement.description" }
        : {}),
      ...(isAdmin
        ? { Moderation: "settings.moderation.description" }
        : {}),
    };

    (Object.keys(TAB_LABEL_KEYS) as TabId[]).forEach((tabId) => {
      const labelKey = TAB_LABEL_KEYS[tabId];
      const descKey = TAB_DESC_KEYS[tabId];
      if (!labelKey) return;
      const texts = [
        ...getTranslationsForAllLocales(labelKey),
        ...(descKey ? getTranslationsForAllLocales(descKey) : []),
      ];
      if (texts.some((txt) => txt.toLowerCase().includes(query))) {
        set.add(tabId);
      }
    });

    searchableItems.forEach((item) => {
      const texts = [
        ...getTranslationsForAllLocales(item.titleKey),
        ...(item.descKey ? getTranslationsForAllLocales(item.descKey) : []),
      ];
      if (texts.some((txt) => txt.toLowerCase().includes(query))) {
        set.add(item.tabId);
      }
    });

    return set;
  }, [searchQuery, isAdmin, searchableItems]);

  const filteredGroups = useMemo(() => {
    if (!matchingTabIds) return visibleGroups;

    return visibleGroups
      .map((group) => {
        const ids = group.ids.filter((id) => matchingTabIds.has(id));
        return { ...group, ids };
      })
      .filter((group) => group.ids.length > 0);
  }, [matchingTabIds, visibleGroups]);

  useEffect(() => {
    if (!searchQuery.trim()) return;
    if (
      matchingTabIds &&
      matchingTabIds.size > 0 &&
      !matchingTabIds.has(activeTab)
    ) {
      const firstMatch = visibleGroups.flatMap((g) => g.ids).find((id) =>
        matchingTabIds.has(id),
      );
      if (firstMatch) {
        setActiveTab(firstMatch);
      }
    }
  }, [searchQuery, matchingTabIds, activeTab, visibleGroups]);

  const openExternal = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const displayName = userDisplayName(user) ?? "Liner";
  const handle = user?.username
    ? `@${user.username}`
    : (user?.email ?? t("settings.manage_account"));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (!next ? handleClose() : undefined)}
      maxWidth={900}
      className="p-0 h-[700px] !max-h-[90vh] !flex-row overflow-hidden !bg-bg-surface/70 dark:!bg-bg-elevated/50 !backdrop-blur-[60px] !border-0"
    >
      <aside className="w-[248px] shrink-0 flex flex-col min-h-0 bg-transparent">
        <div className="px-[12px] pt-[14px] pb-[8px]">
          <div className="relative flex items-center">
            <span
              aria-hidden
              className={`pointer-events-none absolute inset-y-0 flex items-center gap-[6px] text-text-tertiary text-[13px] transition-all duration-200 ${
                searchCentered ? "left-1/2 -translate-x-1/2" : "left-[10px]"
              }`}
              style={font}
            >
              <Search2Line size={15} className="shrink-0" />
              {!searchQuery && (
                <span className="whitespace-nowrap">
                  {t("settings.search_placeholder")}
                </span>
              )}
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              aria-label={t("settings.search_placeholder")}
              className="w-full h-[34px] pl-[28px] pr-[26px] bg-bg-surface/70 dark:bg-white/[0.08] text-text-primary text-[13px] rounded-[10px] border-0 outline-none placeholder:text-text-tertiary focus:bg-bg-surface dark:focus:bg-white/[0.12] transition-colors"
              style={font}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-[6px] p-0 border-0 bg-transparent text-text-tertiary hover:text-text-primary cursor-pointer flex items-center justify-center"
              >
                <CloseCircleFill size={14} />
              </button>
            )}
          </div>
        </div>

        <nav
          ref={attachNavFade}
          onScroll={onNavScroll}
          style={navFadeStyle}
          className="flex-1 min-h-0 overflow-y-auto px-[12px] pb-[12px] flex flex-col gap-[10px]"
          role="tablist"
          aria-label={t("settings.title")}
        >
          {filteredGroups.length === 0 ? (
            <p
              className="text-text-tertiary text-[12px] px-[10px] py-[8px] m-0"
              style={font}
            >
              {t("search.no_results") || "Ничего не найдено"}
            </p>
          ) : (
            filteredGroups.map((group) => (
              <div key={group.labelKey} className="flex flex-col">
                <p
                  className="text-text-tertiary text-[11px] font-[500] m-0 px-[10px] pb-[4px] pt-[2px]"
                  style={font}
                >
                  {t(`settings.groups.${group.labelKey}`)}
                </p>
                <div className={navGroupClass}>
                  {group.ids.map((id) => {
                    const isActive = id === activeTab;
                    const Icon = TAB_ICONS[id];
                    return (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => setActiveTab(id)}
                        className={`w-full flex items-center gap-[10px] px-[10px] py-[7px] rounded-[10px] border-0 cursor-pointer text-left transition-colors ${
                          isActive
                            ? "bg-transparent text-text-primary"
                            : "bg-transparent text-text-secondary hover:bg-black/[0.04] hover:text-text-primary dark:hover:bg-white/[0.05]"
                        }`}
                        style={{
                          ...font,
                          fontSize: "13px",
                          fontWeight: isActive ? 600 : 400,
                        }}
                      >
                        <Icon
                          size={18}
                          weight="Bold"
                          className={
                            isActive
                              ? "text-text-primary shrink-0"
                              : "text-text-tertiary shrink-0"
                          }
                        />
                        <span className="truncate leading-none">
                          {tabLabels[id]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          <div className="flex flex-col">
            <p
              className="text-text-tertiary text-[11px] font-[500] m-0 px-[10px] pb-[4px] pt-[2px]"
              style={font}
            >
              {t("settings.groups.help")}
            </p>
            <div className={navGroupClass}>
              <button
                type="button"
                onClick={() =>
                  openExternal(
                    "https://github.com/tryliner/desktop/blob/main/README.md",
                  )
                }
                className="w-full flex items-center gap-[10px] px-[10px] py-[7px] rounded-[10px] border-0 bg-transparent text-text-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-text-primary cursor-pointer text-left transition-colors"
                style={{ ...font, fontSize: "13px" }}
              >
                <Book2
                  size={18}
                  weight="Bold"
                  className="text-text-tertiary shrink-0"
                />
                <span className="leading-none">{t("settings.docs")}</span>
              </button>
              <button
                type="button"
                onClick={() => openExternal("https://t.me/liner_app?direct")}
                className="w-full flex items-center gap-[10px] px-[10px] py-[7px] rounded-[10px] border-0 bg-transparent text-text-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-text-primary cursor-pointer text-left transition-colors"
                style={{ ...font, fontSize: "13px" }}
              >
                <QuestionCircle
                  size={18}
                  weight="Bold"
                  className="text-text-tertiary shrink-0"
                />
                <span className="leading-none">{t("settings.support")}</span>
              </button>
            </div>
          </div>
        </nav>

        <div className="shrink-0 p-[12px] pt-[8px]">
          <div className="flex items-center gap-[10px] px-[6px] py-[4px] min-w-0">
            <span className="relative shrink-0">
              <UserAvatar user={user ?? null} size={32} />
              <span
                className="absolute right-[-1px] bottom-[-1px] w-[10px] h-[10px] rounded-full bg-[#12B76A] border-2 border-bg-primary"
                aria-hidden
              />
            </span>
            <span className="flex-1 min-w-0 flex flex-col leading-tight">
              <button
                type="button"
                onClick={() => setActiveTab("Account")}
                title={t("settings.profile.edit_profile") || "Edit profile"}
                className="text-text-primary text-[13px] font-[500] truncate text-left border-0 bg-transparent p-0 cursor-pointer hover:underline"
                style={font}
              >
                {displayName}
              </button>
              <span
                className="text-text-tertiary text-[12px] truncate"
                style={font}
              >
                {handle}
              </span>
            </span>
            <button
              type="button"
              onClick={async () => {
                handleClose();
                await logout();
              }}
              title={t("settings.profile.sign_out") || "Log out"}
              aria-label={t("settings.profile.sign_out") || "Log out"}
              className="p-1.5 rounded-md text-text-tertiary hover:text-[#E81123] hover:bg-border-alpha-14 transition-colors border-0 bg-transparent cursor-pointer flex items-center justify-center shrink-0"
            >
              <ExitLine size={18} className="shrink-0" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Right secondary frame: same roundness, inset with padding, darker ── */}
      <div className="flex-1 min-w-0 min-h-0 flex">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col rounded-[20px] bg-bg-primary/40 overflow-hidden">
          <div className="flex items-start justify-between gap-[16px] px-[24px] pt-[24px] pb-[16px] shrink-0">
            <div className="min-w-0">
              <h3 className="font-montserrat text-text-primary text-[20px] m-0 font-[700] tracking-[-0.01em]">
                {tabLabels[activeTab]}
              </h3>
              <p
                className="text-text-secondary text-[12.5px] m-0 mt-[4px] leading-snug"
                style={font}
              >
                {tabDescriptions[activeTab]}
              </p>
            </div>
            <button
              type="button"
              aria-label={t("common.close") || "Close"}
              onClick={handleClose}
              className="w-[28px] h-[28px] shrink-0 inline-flex items-center justify-center rounded-md text-text-tertiary hover:text-text-primary hover:bg-border-alpha-14 transition-colors border-0 bg-transparent p-0 cursor-pointer"
            >
              <CloseLine size={17} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-[24px] pb-[16px] flex flex-col">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 7 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.12, ease: "easeOut" }}
              className="flex-1 flex flex-col"
            >
              {activeTab === "Account" && (
                <AccountTab searchQuery={searchQuery} />
              )}
              {activeTab === "Playback" && (
                <PlaybackTab searchQuery={searchQuery} />
              )}
              {activeTab === "Shortcuts" && (
                <ShortcutsTab searchQuery={searchQuery} />
              )}
              {activeTab === "Overlay" && (
                <OverlayTab searchQuery={searchQuery} />
              )}
              {activeTab === "Youtube" && (
                <YoutubeTab searchQuery={searchQuery} />
              )}
              {activeTab === "AiTranslate" && (
                <AiTranslateSettingsTab />
              )}
              {activeTab === "Appearance" && (
                <AppearanceTab searchQuery={searchQuery} />
              )}
              {activeTab === "Customization" && (
                <CustomizationTab searchQuery={searchQuery} />
              )}
              {activeTab === "Storage" && (
                <StorageTab searchQuery={searchQuery} />
              )}
              {activeTab === "About" && <AboutTab searchQuery={searchQuery} />}
              {activeTab === "Announcement" && isAdmin && (
                <AnnouncementTab searchQuery={searchQuery} />
              )}
              {activeTab === "UserFinder" && isAdmin && (
                <UserFinderTab searchQuery={searchQuery} />
              )}
              {activeTab === "Moderation" && isAdmin && (
                <ModerationTab searchQuery={searchQuery} />
              )}
            </motion.div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
