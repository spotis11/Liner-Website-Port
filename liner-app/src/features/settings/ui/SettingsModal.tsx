import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import {
  CloseLine,
  DiscordFill,
  KeyboardLine,
  User3Line,
  KeyboardFill,
  YoutubeFill,
  AnnouncementLine,
  ForbidCircleLine,
  UserSearchLine,
} from "@mingcute/react";
import {
  Play,
  Palette,
  InfoCircle,
  Database,
  Widget5,
  Gallery,
  Translation,
  Crown,
} from "@solar-icons/react";
import Dialog from "@/shared/ui/Dialog";
import { DialogHeader } from "@/shared/ui";
import { useScrollFade } from "@/shared/hooks";
import { useTranslation, getTranslationsForAllLocales } from "@/languages";
import { useModalStore } from "@/features/library";
import {
  PlaybackTab,
  ShortcutsTab,
  AppearanceTab,
  CustomizationTab,
  StorageTab,
  AboutTab,
  OverlayTab,
  DiscordTab,
  YoutubeTab,
  AccountTab,
  ProTab,
  AnnouncementTab,
  UserFinderTab,
  ModerationTab,
} from "./tabs";
import { AiTranslateSettingsTab } from "@/features/lyrics";
import { useAuthStore } from "@/features/auth";
import { isWebsiteAdmin } from "@/features/announcements";
import { SettingsSidebar, type SettingsNavIconProps } from "./SettingsSidebar";

type TabId =
  | "Account"
  | "Pro"
  | "Playback"
  | "Shortcuts"
  | "Overlay"
  | "Discord"
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
  Pro: Crown,
  Playback: Play,
  Shortcuts: KeyboardFill,
  Overlay: Widget5,
  Discord: DiscordFill,
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
  { labelKey: "account", ids: ["Account", "Pro"] },
  { labelKey: "player", ids: ["Playback", "Shortcuts"] },
  { labelKey: "interface", ids: ["Appearance", "Customization", "Overlay"] },
  { labelKey: "integrations", ids: ["Youtube", "AiTranslate", "Discord"] },
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

  // Liner Pro
  {
    tabId: "Pro",
    titleKey: "settings.pro.tagline",
  },
  {
    tabId: "Pro",
    titleKey: "settings.pro.b1_title",
    descKey: "settings.pro.b1_desc",
  },
  {
    tabId: "Pro",
    titleKey: "settings.pro.b2_title",
    descKey: "settings.pro.b2_desc",
  },
  {
    tabId: "Pro",
    titleKey: "settings.pro.b3_title",
    descKey: "settings.pro.b3_desc",
  },
  {
    tabId: "Pro",
    titleKey: "settings.pro.b4_title",
    descKey: "settings.pro.b4_desc",
  },
  {
    tabId: "Pro",
    titleKey: "settings.pro.b5_title",
    descKey: "settings.pro.b5_desc",
  },
  {
    tabId: "Pro",
    titleKey: "settings.pro.b6_title",
    descKey: "settings.pro.b6_desc",
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

  // Discord
  {
    tabId: "Discord",
    titleKey: "settings.discord.enable.title",
    descKey: "settings.discord.enable.description",
  },
  {
    tabId: "Discord",
    titleKey: "settings.discord.show_timeline.title",
    descKey: "settings.discord.show_timeline.description",
  },
  {
    tabId: "Discord",
    titleKey: "settings.discord.show_artwork.title",
    descKey: "settings.discord.show_artwork.description",
  },
  {
    tabId: "Discord",
    titleKey: "settings.discord.show_artist_image.title",
    descKey: "settings.discord.show_artist_image.description",
  },
  {
    tabId: "Discord",
    titleKey: "settings.discord.show_paused.title",
    descKey: "settings.discord.show_paused.description",
  },
  {
    tabId: "Discord",
    titleKey: "settings.discord.show_button.title",
    descKey: "settings.discord.show_button.description",
  },
  {
    tabId: "Discord",
    titleKey: "settings.discord.show_download_button.title",
    descKey: "settings.discord.show_download_button.description",
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
  {
    tabId: "Youtube",
    titleKey: "settings.youtube.sign_out_with_liner.title",
    descKey: "settings.youtube.sign_out_with_liner.description",
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
    tabId: "Appearance",
    titleKey: "settings.appearance.liquid_glass_title",
    descKey: "settings.appearance.liquid_glass_description",
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
  {
    tabId: "Storage",
    titleKey: "settings.storage.sign_out_choice",
    descKey: "settings.storage.sign_out_choice_ask",
  },
  { tabId: "Storage", titleKey: "settings.storage.downloads_title" },
  { tabId: "Storage", titleKey: "settings.storage.categories.liked" },
  { tabId: "Storage", titleKey: "settings.storage.categories.local" },
  { tabId: "Storage", titleKey: "settings.storage.categories.shared" },
  { tabId: "Storage", titleKey: "settings.storage.downloads_limit" },
  {
    tabId: "Storage",
    titleKey: "settings.storage.cache_row_title",
    descKey: "settings.storage.cache_row_desc",
  },
  { tabId: "Storage", titleKey: "settings.storage.cache_limit" },
  {
    tabId: "Storage",
    titleKey: "settings.storage.cached_in_library",
    descKey: "settings.storage.cached_in_library_desc",
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

  const handleClose = () => {
    setSearchQuery("");
    close();
  };

  const tabLabels: Record<TabId, string> = {
    Account: t("settings.tabs.account") || "Account",
    Pro: t("settings.tabs.pro") || "Liner Pro",
    Playback: t("settings.tabs.playback"),
    Shortcuts: t("settings.tabs.shortcuts") || "Shortcuts",
    Overlay: t("settings.tabs.overlay") || "Overlay",
    Discord: t("settings.tabs.discord") || "Discord RPC",
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
    Pro:
      t("settings.pro.description") ||
      "The premium Liner experience — bigger library, animated profile and more.",
    Playback: t("settings.playback.description"),
    Shortcuts:
      t("settings.shortcuts.description") ||
      "System-wide and player keyboard shortcuts.",
    Overlay:
      t("settings.overlay.description") ||
      "Desktop overlay behavior, position and lyrics display.",
    Discord:
      t("settings.discord.description") ||
      "Show what you're listening to on Discord with artwork, artist badge and progress bar.",
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
      Pro: "settings.tabs.pro",
      Playback: "settings.tabs.playback",
      Shortcuts: "settings.tabs.shortcuts",
      Overlay: "settings.tabs.overlay",
      Discord: "settings.tabs.discord",
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
      Pro: "settings.pro.description",
      Playback: "settings.playback.description",
      Shortcuts: "settings.shortcuts.description",
      Overlay: "settings.overlay.description",
      Discord: "settings.discord.description",
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

  const {
    attach: attachContentFade,
    onScroll: onContentScroll,
    style: contentFadeStyle,
  } = useScrollFade<HTMLDivElement>();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (!next ? handleClose() : undefined)}
      maxWidth={940}
      className="p-0 h-[720px] !max-h-[90vh] !flex-row overflow-hidden"
    >
      <SettingsSidebar
        groups={filteredGroups}
        activeTab={activeTab}
        onSelect={setActiveTab}
        labels={tabLabels}
        icons={TAB_ICONS}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onClose={handleClose}
      />

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <DialogHeader
          className="shrink-0 px-[20px] pt-[20px] pb-[16px]"
          title={tabLabels[activeTab]}
          description={tabDescriptions[activeTab]}
          trailing={
            <button
              type="button"
              aria-label={t("common.close") || "Close"}
              onClick={handleClose}
              className="-mt-[2px] -mr-[6px] inline-flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-control border-0 bg-transparent p-0 text-text-tertiary transition-colors hover:bg-fill hover:text-text-primary"
            >
              <CloseLine size={17} />
            </button>
          }
        />

        <div
          ref={attachContentFade}
          onScroll={onContentScroll}
          style={contentFadeStyle}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="flex min-h-full w-full flex-col px-[20px] pt-[2px] pb-[20px] font-sans">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="flex-1 flex flex-col"
            >
              {activeTab === "Account" && (
                <AccountTab searchQuery={searchQuery} />
              )}
              {activeTab === "Pro" && <ProTab searchQuery={searchQuery} />}
              {activeTab === "Playback" && (
                <PlaybackTab searchQuery={searchQuery} />
              )}
              {activeTab === "Shortcuts" && (
                <ShortcutsTab searchQuery={searchQuery} />
              )}
              {activeTab === "Overlay" && (
                <OverlayTab searchQuery={searchQuery} />
              )}
              {activeTab === "Discord" && (
                <DiscordTab searchQuery={searchQuery} />
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
