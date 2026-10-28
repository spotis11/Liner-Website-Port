import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation, getTranslationsForAllLocales } from "@/languages";
import Button from "@/shared/ui/Button";
import { TextInput, Select, useToast } from "@/shared/ui";
import { useAuthStore } from "@/features/auth";
import { getValidAccessToken } from "@/shared/api/auth-session";
import { SettingSection } from "@/features/settings/ui/controls";
import {
  BAN_DURATION_PRESETS,
  ModerationError,
  addBan,
  formatBanRemaining,
  listBans,
  normalizeUsername,
  removeBan,
  type BanInfo,
  type BanType,
} from "@/features/moderation/lib/moderationApi";
import { isWebsiteAdmin } from "@/features/announcements";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

const SEARCH_KEYS = [
  "settings.tabs.moderation",
  "settings.moderation.description",
  "settings.moderation.section_title",
  "settings.moderation.ban_title",
  "settings.moderation.unban_title",
];

type DurationChoice = (typeof BAN_DURATION_PRESETS)[number]["value"];

/**
 * Website-port-only settings tab. Lets the site owner ban accounts from this
 * website (hours or forever, normal or IP-level) and lift bans again by
 * typing the account's Liner username. Only rendered for the owner's Liner
 * account (jayzeyluna) — other users never see this tab.
 */
export function ModerationTab({ searchQuery }: { searchQuery?: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const user = useAuthStore((s) => s.user);

  const [bans, setBans] = useState<BanInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [banUsername, setBanUsername] = useState("");
  const [banType, setBanType] = useState<BanType>("normal");
  const [duration, setDuration] = useState<DurationChoice>("forever");
  const [customHours, setCustomHours] = useState("24");
  const [reason, setReason] = useState("");

  const [unbanUsername, setUnbanUsername] = useState("");

  const isAdmin = isWebsiteAdmin(user?.username);

  const isMatch = useMemo(() => {
    if (!isAdmin) return false;
    if (!searchQuery?.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return SEARCH_KEYS.some((k) =>
      getTranslationsForAllLocales(k).some((txt) => txt.toLowerCase().includes(q)),
    );
  }, [searchQuery, isAdmin]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // null is fine — the website admin cookie can vouch for the browser
      // when the Liner session is dead (the server decides, not the client)
      const accessToken = await getValidAccessToken().catch(() => null);
      setBans(await listBans(accessToken));
    } catch (err) {
      if (err instanceof ModerationError && err.code === "unauthorized") {
        toast(t("settings.moderation.error_unauthorized"), "error");
      } else {
        toast(t("settings.moderation.error_generic"), "error");
      }
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    if (isAdmin) void refresh();
  }, [isAdmin, refresh]);

  if (!isAdmin || !isMatch) return null;

  const now = Date.now();
  const trimmed = banUsername.trim().toLowerCase();
  const presetHours =
    BAN_DURATION_PRESETS.find((preset) => preset.value === duration)?.hours ?? null;
  const parsedCustomHours = Number(customHours.trim());
  const customHoursValid =
    Number.isFinite(parsedCustomHours) &&
    parsedCustomHours > 0 &&
    parsedCustomHours <= 87_600;
  const durationValid = presetHours === -1 ? customHoursValid : true;
  const effectiveHours =
    presetHours === -1 ? (customHoursValid ? parsedCustomHours : null) : presetHours;
  const canBan = normalizeUsername(trimmed) !== null && durationValid && !busy;
  const canUnban = normalizeUsername(unbanUsername.trim()) !== null && !busy;

  const handleError = (err: unknown) => {
    if (err instanceof ModerationError) {
      switch (err.code) {
        case "unauthorized":
          toast(t("settings.moderation.error_unauthorized"), "error");
          return;
        case "forbidden":
          toast(t("settings.moderation.error_forbidden"), "error");
          return;
        case "cannot_ban_admin":
          toast(t("settings.moderation.error_admin"), "error");
          return;
        case "invalid_username":
          toast(t("settings.moderation.error_username"), "error");
          return;
        case "invalid_duration":
          toast(t("settings.moderation.error_duration"), "error");
          return;
        case "not_banned":
          toast(t("settings.moderation.error_not_banned"), "error");
          return;
        default:
          toast(t("settings.moderation.error_generic"), "error");
          return;
      }
    }
    toast(t("settings.moderation.error_generic"), "error");
  };

  const handleBan = async () => {
    if (!canBan) {
      if (normalizeUsername(trimmed) === null) {
        toast(t("settings.moderation.error_username"), "error");
      } else if (!durationValid) {
        toast(t("settings.moderation.error_duration"), "error");
      }
      return;
    }
    setBusy(true);
    try {
      const accessToken = await getValidAccessToken().catch(() => null);
      const ban = await addBan(
        {
          username: trimmed,
          type: banType,
          durationHours: effectiveHours,
          reason: reason.trim() || null,
        },
        accessToken,
      );
      toast(t("settings.moderation.toast_banned", { username: ban.username }));
      setBanUsername("");
      setReason("");
      await refresh();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleUnban = async (username: string) => {
    const normalized = normalizeUsername(username);
    if (!normalized) {
      toast(t("settings.moderation.error_username"), "error");
      return;
    }
    setBusy(true);
    try {
      const accessToken = await getValidAccessToken().catch(() => null);
      await removeBan(normalized, accessToken);
      toast(t("settings.moderation.toast_unbanned", { username: normalized }));
      setUnbanUsername("");
      await refresh();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  const durationOptions = BAN_DURATION_PRESETS.map((preset) => ({
    value: preset.value,
    label:
      preset.value === "forever"
        ? t("settings.moderation.duration_forever")
        : preset.value === "custom"
          ? t("settings.moderation.duration_custom")
          : preset.hours === 1
            ? t("settings.moderation.duration_hour", { count: preset.hours })
            : t("settings.moderation.duration_hours", { count: preset.hours ?? 0 }),
  }));

  return (
    <div className="flex flex-col gap-[22px]">
      <SettingSection label={t("settings.moderation.section_title")}>
        <div className="flex flex-col gap-[12px] rounded-[12px] bg-black/[0.04] px-[16px] py-[16px] dark:bg-white/[0.08]">
          <p className="m-0 text-[13px] leading-[1.5] text-text-secondary" style={font}>
            {t("settings.moderation.section_subtitle")}
          </p>

          {/* active bans */}
          <div className="flex flex-col gap-[8px]">
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-[500] leading-snug text-text-primary">
                {t("settings.moderation.list_title")}
              </span>
              <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
                {t("settings.moderation.refresh")}
              </Button>
            </div>
            {loading ? (
              <p className="m-0 text-[12px] text-text-tertiary" style={font}>
                {t("settings.moderation.loading")}
              </p>
            ) : bans.length === 0 ? (
              <p className="m-0 text-[12px] text-text-tertiary" style={font}>
                {t("settings.moderation.list_empty")}
              </p>
            ) : (
              <ul className="m-0 flex max-h-[220px] list-none flex-col gap-[6px] overflow-y-auto p-0">
                {bans.map((ban) => {
                  const remaining = formatBanRemaining(ban.expiresAt, now);
                  return (
                    <li
                      key={ban.username}
                      className="flex items-center justify-between gap-[10px] rounded-[10px] border border-border-primary/60 bg-bg-primary/60 px-[12px] py-[8px]"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="flex items-center gap-[8px]">
                          <span
                            className="truncate font-montserrat text-[13px] font-[700] text-text-primary"
                            style={font}
                          >
                            @{ban.username}
                          </span>
                          <span
                            className={`rounded-full px-[8px] py-[1px] text-[10px] font-[600] uppercase tracking-wide ${
                              ban.type === "ip"
                                ? "bg-accent-primary/15 text-accent-primary"
                                : "bg-black/10 text-text-secondary dark:bg-white/15 dark:text-text-secondary"
                            }`}
                          >
                            {ban.type === "ip"
                              ? t("settings.moderation.type_ip")
                              : t("settings.moderation.type_normal")}
                          </span>
                        </span>
                        <span className="truncate text-[11px] text-text-tertiary" style={font}>
                          {remaining.text}
                          {ban.bannedIps && ban.bannedIps.length > 0
                            ? ` · ${t("settings.moderation.ip_count", {
                                count: ban.bannedIps.length,
                              })}`
                            : ""}
                          {ban.reason ? ` · ${ban.reason}` : ""}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void handleUnban(ban.username)}
                      >
                        {t("settings.moderation.unban_button")}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* ban form */}
          <div className="flex flex-col gap-[10px] border-t border-border-primary/50 pt-[12px]">
            <span className="text-[14px] font-[500] leading-snug text-text-primary">
              {t("settings.moderation.ban_title")}
            </span>
            <div className="flex flex-col gap-[8px] sm:flex-row">
              <TextInput
                size="sm"
                value={banUsername}
                placeholder={t("settings.moderation.username_placeholder")}
                onChange={(e) => setBanUsername(e.target.value)}
                disabled={busy}
                className="flex-1"
              />
              <Select<BanType>
                options={[
                  { value: "normal", label: t("settings.moderation.type_normal") },
                  { value: "ip", label: t("settings.moderation.type_ip") },
                ]}
                value={banType}
                onChange={(value) => setBanType(value)}
                disabled={busy}
                aria-label={t("settings.moderation.type_label")}
                className="sm:w-[140px]"
              />
            </div>
            <div className="flex flex-col gap-[8px] sm:flex-row">
              <Select<DurationChoice>
                options={durationOptions}
                value={duration}
                onChange={(value) => setDuration(value)}
                disabled={busy}
                aria-label={t("settings.moderation.duration_label")}
                className="flex-1"
              />
              {duration === "custom" ? (
                <TextInput
                  size="sm"
                  type="number"
                  min={1}
                  value={customHours}
                  placeholder={t("settings.moderation.custom_hours_placeholder")}
                  onChange={(e) => setCustomHours(e.target.value)}
                  disabled={busy}
                  className="sm:w-[140px]"
                />
              ) : null}
            </div>
            <TextInput
              size="sm"
              value={reason}
              maxLength={300}
              placeholder={t("settings.moderation.reason_placeholder")}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
            />
            <div className="flex items-center justify-between gap-[10px]">
              <span className="text-[12px] text-text-tertiary" style={font}>
                {t("settings.moderation.ban_hint")}
              </span>
              <Button onClick={() => void handleBan()} disabled={!canBan} size="sm">
                {busy
                  ? t("settings.moderation.working")
                  : t("settings.moderation.ban_button")}
              </Button>
            </div>
          </div>

          {/* unban by username */}
          <div className="flex flex-col gap-[8px] border-t border-border-primary/50 pt-[12px]">
            <span className="text-[14px] font-[500] leading-snug text-text-primary">
              {t("settings.moderation.unban_title")}
            </span>
            <div className="flex items-center gap-[8px]">
              <TextInput
                size="sm"
                value={unbanUsername}
                placeholder={t("settings.moderation.username_placeholder")}
                onChange={(e) => setUnbanUsername(e.target.value)}
                disabled={busy}
                className="flex-1"
              />
              <Button
                size="sm"
                disabled={!canUnban}
                onClick={() => void handleUnban(unbanUsername)}
              >
                {t("settings.moderation.unban_button")}
              </Button>
            </div>
            <span className="text-[12px] text-text-tertiary" style={font}>
              {t("settings.moderation.unban_hint")}
            </span>
          </div>
        </div>
      </SettingSection>
    </div>
  );
}

export default ModerationTab;
