import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search2Line,
  User3Line,
  MailLine,
  CalendarLine,
  TimeLine,
  Music2Line,
  ForbidCircleLine,
  WifiLine,
  GroupLine,
  DiamondLine,
} from "@mingcute/react";
import Button from "@/shared/ui/Button";
import { TextInput, UserAvatar, useToast } from "@/shared/ui";
import { useTranslation, getTranslationsForAllLocales } from "@/languages";
import { getValidAccessToken } from "@/shared/api/auth-session";
import { SettingSection } from "@/features/settings/ui/controls";
import { normalizeUsername } from "@/features/moderation";
import {
  findUser,
  UserFinderError,
  type UserFinderResult,
} from "../../lib/userFinderApi";
import { isWebsiteAdmin } from "@/features/announcements";
import { useAuthStore } from "@/features/auth";

/**
 * Website-port-only settings tab (site owner @jayzeyluna): type a Liner
 * username and see what THIS website knows about the account — profile
 * (email / display name / avatar / account created), last seen on the
 * website, and the songs they played here recently.
 */

const SEARCH_KEYS = [
  "settings.user_finder.title",
  "settings.user_finder.description",
  "settings.user_finder.search_placeholder",
];

function formatDate(iso: string | null | undefined): string {
  if (!iso) return null as unknown as string;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null as unknown as string;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "--:--";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-[10px] px-[2px] py-[5px]">
      <Icon size={15} className="mt-[2px] shrink-0 text-text-tertiary" />
      <span className="w-[150px] shrink-0 text-[12.5px] text-text-tertiary">
        {label}
      </span>
      <span className="min-w-0 flex-1 break-words text-[13px] font-[500] text-text-primary">
        {value}
      </span>
    </div>
  );
}

export default function UserFinderTab({
  searchQuery,
}: {
  searchQuery?: string;
} = {}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const authUser = useAuthStore((state) => state.user);
  const isAdmin = isWebsiteAdmin(authUser?.username);

  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UserFinderResult | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const isMatch = useMemo(() => {
    if (!searchQuery?.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return SEARCH_KEYS.some((k) =>
      getTranslationsForAllLocales(k).some((txt) =>
        txt.toLowerCase().includes(q),
      ),
    );
  }, [searchQuery]);

  const lookup = useCallback(
    async (rawName: string) => {
      const trimmed = rawName.trim().toLowerCase();
      if (normalizeUsername(trimmed) === null) {
        toast.error(t("settings.user_finder.error_username"));
        return;
      }
      const requestId = ++requestIdRef.current;
      setBusy(true);
      setNotFound(null);
      try {
        const accessToken = await getValidAccessToken().catch(() => null);
        const found = await findUser(trimmed, accessToken);
        if (requestId !== requestIdRef.current) return;
        if (!found.found) {
          setResult(null);
          setNotFound(trimmed);
        } else {
          setResult(found);
        }
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        if (err instanceof UserFinderError) {
          if (err.code === "unauthorized") {
            toast.error(t("settings.user_finder.error_unauthorized"));
          } else if (err.code === "forbidden") {
            toast.error(t("settings.user_finder.error_forbidden"));
          } else if (err.code === "invalid_username") {
            toast.error(t("settings.user_finder.error_username"));
          } else {
            toast.error(t("settings.user_finder.error_generic"));
          }
        } else {
          toast.error(t("settings.user_finder.error_generic"));
        }
      } finally {
        if (requestId === requestIdRef.current) setBusy(false);
      }
    },
    [toast, t],
  );

  useEffect(() => {
    if (!isAdmin) return;
    // nothing to preload — the tab starts empty until the owner searches
  }, [isAdmin]);

  if (!isAdmin || !isMatch) return null;

  const canSearch = normalizeUsername(username.trim().toLowerCase()) !== null && !busy;

  return (
    <div className="flex flex-col gap-[16px]" data-testid="user-finder-tab">
      <SettingSection label={t("settings.user_finder.title")}>
        <p className="m-0 text-[12.5px] leading-[1.45] text-text-tertiary">
          {t("settings.user_finder.description")}
        </p>
        <div className="flex items-center gap-[8px]">
          <TextInput
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canSearch) void lookup(username);
            }}
            placeholder={t("settings.user_finder.search_placeholder")}
            icon={<Search2Line size={15} />}
            size="sm"
            className="min-w-0 flex-1"
            disabled={busy}
            aria-label={t("settings.user_finder.search_placeholder")}
          />
          <Button
            variant="primary"
            onClick={() => void lookup(username)}
            disabled={!canSearch}
            className="!h-[36px] shrink-0 px-[16px] !text-[12.5px]"
          >
            {busy ? t("settings.user_finder.searching") : t("settings.user_finder.find")}
          </Button>
        </div>
      </SettingSection>

      {notFound && (
        <p className="m-0 text-[13px] text-text-tertiary">
          {t("settings.user_finder.not_found", { username: notFound })}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-[14px]">
          {/* profile card */}
          <div className="rounded-[14px] border border-border-alpha-14 bg-bg-surface/70 p-[16px] dark:bg-white/[0.06]">
            <div className="flex items-center gap-[14px]">
              <UserAvatar
                user={{
                  username: result.username,
                  displayName: result.profile?.displayName ?? null,
                  avatarUrl: result.profile?.avatarUrl ?? null,
                }}
                size={52}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-[8px]">
                  <p className="m-0 truncate text-[16px] font-[700] text-text-primary">
                    {result.profile?.displayName || result.username}
                  </p>
                  {result.isAdminAccount && (
                    <span className="shrink-0 rounded-full bg-[#e08c3f]/18 px-[8px] py-[2px] text-[11px] font-[600] text-[#e08c3f]">
                      owner
                    </span>
                  )}
                </div>
                <p className="m-0 truncate text-[13px] text-text-secondary">
                  @{result.username}
                  {result.profile?.userId ? ` · ${result.profile.userId}` : ""}
                </p>
                <span
                  className="mt-[4px] inline-flex w-fit items-center gap-[4px] rounded-full bg-border-alpha-14 px-[8px] py-[2px] text-[10.5px] font-[600] text-text-tertiary"
                  data-testid="user-finder-source"
                >
                  <DiamondLine size={11} />
                  {result.profileSource === "cache"
                    ? t("settings.user_finder.source_cache")
                    : t("settings.user_finder.source_live")}
                </span>
              </div>
            </div>

            <div className="mt-[10px] flex flex-col">
              <InfoRow
                icon={MailLine}
                label={t("settings.user_finder.email")}
                value={result.profile?.email ?? t("settings.user_finder.unknown")}
              />
              <InfoRow
                icon={CalendarLine}
                label={t("settings.user_finder.account_created")}
                value={
                  formatDate(result.profile?.accountCreatedAt) ??
                  t("settings.user_finder.unknown")
                }
              />
              {(result.profile?.followersCount != null ||
                result.profile?.followingCount != null) && (
                <InfoRow
                  icon={GroupLine}
                  label={t("settings.user_finder.followers")}
                  value={t("settings.user_finder.follow_stats", {
                    followers: result.profile.followersCount ?? 0,
                    following: result.profile.followingCount ?? 0,
                  })}
                />
              )}
              <InfoRow
                icon={TimeLine}
                label={t("settings.user_finder.last_seen")}
                value={
                  result.profile?.lastSeenAt
                    ? `${formatDate(result.profile.lastSeenAt)} (${timeAgo(result.profile.lastSeenAt)} ago)`
                    : t("settings.user_finder.unknown")
                }
              />
              {result.lastIp && (
                <InfoRow
                  icon={WifiLine}
                  label={t("settings.user_finder.last_ip")}
                  value={`${result.lastIp.ip} · ${timeAgo(result.lastIp.updatedAt)} ago`}
                />
              )}
              {result.ban && (
                <InfoRow
                  icon={ForbidCircleLine}
                  label={t("settings.user_finder.ban_status")}
                  value={
                    <span className="text-[#e05545]">
                      {t("settings.user_finder.banned", {
                        type: result.ban.type,
                        reason: result.ban.reason ?? "—",
                      })}
                    </span>
                  }
                />
              )}
            </div>
          </div>

          {/* recent songs */}
          <div className="rounded-[14px] border border-border-alpha-14 bg-bg-surface/70 p-[16px] dark:bg-white/[0.06]">
            <p className="m-0 text-[13px] font-[700] text-text-primary">
              {t("settings.user_finder.recent_songs")}
            </p>
            {!result.recentSongs || result.recentSongs.length === 0 ? (
              <p className="m-0 mt-[8px] text-[12.5px] text-text-tertiary">
                {t("settings.user_finder.no_songs")}
              </p>
            ) : (
              <div className="mt-[8px] flex flex-col gap-[2px]">
                {result.recentSongs.map((song, index) => (
                  <div
                    key={`${song.source}:${song.title}:${song.playedAt}:${index}`}
                    className="flex items-center gap-[10px] rounded-lg px-[6px] py-[6px] hover:bg-border-alpha-14"
                  >
                    <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-border-alpha-14 text-text-tertiary">
                      {song.artwork ? (
                        <img
                          src={song.artwork}
                          alt=""
                          className="h-full w-full object-cover"
                          draggable={false}
                        />
                      ) : (
                        <Music2Line size={16} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="m-0 truncate text-[13px] font-[600] text-text-primary">
                        {song.title}
                      </p>
                      <p className="m-0 truncate text-[12px] text-text-secondary">
                        {song.artist}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11.5px] tabular-nums text-text-tertiary">
                      {timeAgo(song.playedAt)} ago
                    </span>
                    <span className="hidden shrink-0 text-[11.5px] tabular-nums text-text-tertiary sm:block">
                      {formatDuration(song.duration)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
