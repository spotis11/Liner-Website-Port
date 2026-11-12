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
import {
  fetchMaintenanceStatus,
  setMaintenanceRemote,
  MaintenanceError,
} from "@/features/maintenance";
import {
  fetchShowcaseStatus,
  setShowcaseRemote,
  ShowcaseError,
} from "@/features/showcase";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

const SEARCH_KEYS = [
  "settings.tabs.moderation",
  "settings.moderation.description",
  "settings.moderation.section_title",
  "settings.moderation.ban_title",
  "settings.moderation.unban_title",
  "settings.maintenance.section_title",
  "settings.maintenance.section_subtitle",
  "settings.showcase.section_title",
  "settings.showcase.section_subtitle",
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

  // maintenance switch state
  const [maintOn, setMaintOn] = useState(false);
  const [maintBusy, setMaintBusy] = useState(false);
  const [maintLoaded, setMaintLoaded] = useState(false);
  const [maintReasons, setMaintReasons] = useState("");

  // website showcase (randomize website) state
  const [showcaseOn, setShowcaseOn] = useState(false);
  const [showcaseBusy, setShowcaseBusy] = useState(false);
  const [showcaseLoaded, setShowcaseLoaded] = useState(false);

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

  // keep the maintenance switch in sync with the backend
  const refreshMaintenance = useCallback(async () => {
    try {
      const status = await fetchMaintenanceStatus();
      setMaintOn(status.enabled);
      if (!maintLoaded && status.reasons.length > 0) {
        setMaintReasons(status.reasons.join("\n"));
      }
      setMaintLoaded(true);
    } catch {
      setMaintLoaded(true);
    }
  }, [maintLoaded]);

  useEffect(() => {
    if (isAdmin) void refreshMaintenance();
  }, [isAdmin, refreshMaintenance]);

  // keep the showcase switch in sync with the backend
  const refreshShowcase = useCallback(async () => {
    try {
      const status = await fetchShowcaseStatus();
      setShowcaseOn(status.enabled);
    } catch {
      // the switch just stays where it is; the status line says unknown
    } finally {
      setShowcaseLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void refreshShowcase();
  }, [isAdmin, refreshShowcase]);

  const handleShowcaseToggle = async () => {
    setShowcaseBusy(true);
    try {
      const accessToken = await getValidAccessToken().catch(() => null);
      const next = await setShowcaseRemote(!showcaseOn, accessToken);
      setShowcaseOn(next.enabled);
      toast(
        t(next.enabled ? "settings.showcase.started_toast" : "settings.showcase.stopped_toast"),
        "success",
      );
    } catch (err) {
      if (err instanceof ShowcaseError && (err.code === "unauthorized" || err.code === "forbidden")) {
        toast(t("settings.moderation.error_unauthorized"), "error");
      } else {
        toast(t("settings.showcase.error"), "error");
      }
    } finally {
      setShowcaseBusy(false);
    }
  };

  const handleMaintenanceToggle = async () => {
    setMaintBusy(true);
    try {
      const accessToken = await getValidAccessToken().catch(() => null);
      const reasons = maintReasons
        .split("\n")
        .map((r) => r.trim())
        .filter((r) => r.length > 0);
      const next = await setMaintenanceRemote(
        !maintOn,
        reasons.length > 0 ? reasons : undefined,
        accessToken,
      );
      setMaintOn(next.enabled);
      if (next.reasons.length > 0) setMaintReasons(next.reasons.join("\n"));
      toast(
        t(next.enabled ? "settings.maintenance.started_toast" : "settings.maintenance.stopped_toast"),
        "success",
      );
    } catch (err) {
      if (err instanceof MaintenanceError && (err.code === "unauthorized" || err.code === "forbidden")) {
        toast(t("settings.moderation.error_unauthorized"), "error");
      } else {
        toast(t("settings.maintenance.error"), "error");
      }
    } finally {
      setMaintBusy(false);
    }
  };

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

      <SettingSection label={t("settings.maintenance.section_title")}>
        <div className="flex flex-col gap-[12px] rounded-[12px] bg-black/[0.04] px-[16px] py-[16px] dark:bg-white/[0.08]">
          <p className="m-0 text-[13px] leading-[1.5] text-text-secondary" style={font}>
            {t("settings.maintenance.section_subtitle")}
          </p>

          <div className="flex items-center justify-between gap-[10px]">
            <span
              className="text-[13px] font-[600]"
              style={{
                ...font,
                color: maintOn ? "var(--color-danger, #ff5a5f)" : undefined,
              }}
            >
              {maintOn
                ? t("settings.maintenance.status_on")
                : t("settings.maintenance.status_off")}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refreshMaintenance()}
            >
              {t("settings.maintenance.refresh")}
            </Button>
          </div>

          <div className="flex flex-col gap-[6px]">
            <label
              htmlFor="maintenance-reasons"
              className="text-text-primary text-[13px] font-[500] leading-snug"
              style={font}
            >
              {t("settings.maintenance.reasons_label")}
            </label>
            <textarea
              id="maintenance-reasons"
              value={maintReasons}
              rows={4}
              placeholder={t("settings.maintenance.reasons_placeholder")}
              onChange={(e) => setMaintReasons(e.target.value)}
              className="w-full resize-none rounded-md border border-border-primary bg-bg-primary px-[12px] py-[9px] text-[13px] text-text-primary outline-none placeholder:text-text-tertiary transition-[border-color] duration-150 focus:border-border-alpha-33"
              style={{ fontFamily: "var(--font-inter), sans-serif" }}
            />
          </div>

          <div>
            <Button
              size="sm"
              variant={maintOn ? "outline" : "primary"}
              disabled={maintBusy}
              onClick={() => void handleMaintenanceToggle()}
            >
              {maintBusy
                ? t("settings.maintenance.apply_busy")
                : maintOn
                  ? t("settings.maintenance.stop")
                  : t("settings.maintenance.start")}
            </Button>
          </div>
        </div>
      </SettingSection>

      <SettingSection label={t("settings.showcase.section_title")}>
        <div className="flex flex-col gap-[12px] rounded-[12px] bg-black/[0.04] px-[16px] py-[16px] dark:bg-white/[0.08]">
          <p className="m-0 text-[13px] leading-[1.5] text-text-secondary" style={font}>
            {t("settings.showcase.section_subtitle")}
          </p>

          <div className="flex items-center justify-between gap-[10px]">
            <span
              className="text-[13px] font-[600]"
              style={{
                ...font,
                color: showcaseOn ? "var(--color-accent-primary, #7c5cff)" : undefined,
              }}
            >
              {showcaseOn
                ? t("settings.showcase.status_on")
                : t("settings.showcase.status_off")}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refreshShowcase()}
            >
              {t("settings.showcase.refresh")}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-[10px] border-t border-border-primary/50 pt-[12px]">
            <span className="text-[12px] text-text-tertiary" style={font}>
              {t("settings.showcase.dedication")}
            </span>
            <Button
              size="sm"
              variant={showcaseOn ? "outline" : "primary"}
              disabled={showcaseBusy || (!showcaseLoaded && !showcaseOn)}
              onClick={() => void handleShowcaseToggle()}
            >
              {showcaseBusy
                ? t("settings.showcase.apply_busy")
                : showcaseOn
                  ? t("settings.showcase.stop")
                  : t("settings.showcase.start")}
            </Button>
          </div>
        </div>
      </SettingSection>
    </div>
  );
}

export default ModerationTab;
