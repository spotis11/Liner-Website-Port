import { useEffect, useMemo, useState } from "react";
import { useTranslation, getTranslationsForAllLocales } from "@classic/languages";
import Button from "@classic/shared/ui/Button";
import {
  Dialog,
  DialogActions,
  DialogButton,
  DialogHeader,
  UserAvatar,
  useToast,
} from "@classic/shared/ui";
import { useAuthStore } from "@classic/features/auth";
import { userDisplayName } from "@classic/entities/user";
import { getValidAccessToken } from "@classic/shared/api/auth-session";
import { toMaxQualityAvatarUrl } from "@classic/shared/api";
import { SettingSection } from "../controls";
import {
  AnnouncementError,
  isWebsiteAdmin,
  sendAnnouncement,
} from "@classic/features/announcements";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;
const MESSAGE_MAX = 500;
const OWNER_GATE_KEY_STORAGE = "liner_owner_gate_key";

const SEARCH_KEYS = [
  "settings.tabs.announcement",
  "settings.announcement.description",
  "settings.announcement.section_title",
  "settings.announcement.section_subtitle",
  "settings.announcement.message_label",
  "settings.announcement.send",
];

/**
 * Website-port-only settings tab. Lets the site owner broadcast a global
 * announcement to everyone currently on the website. Only rendered for the
 * owner's Liner account (jayzeyluna) — other users never see this tab.
 */
export function AnnouncementTab({ searchQuery }: { searchQuery?: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const user = useAuthStore((s) => s.user);

  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // possession-proof of ADMIN_GATE_SECRET (owner-only). Some hosts (the
  // running.sh deployment) are WAF-blocked from the upstream, so the Liner
  // token can never be verified server-side and the admin cookie can never
  // bootstrap — this key unlocks the very first broadcast there, and the
  // server then mints the 30-day admin cookie so it is only needed once.
  const [ownerKey, setOwnerKey] = useState("");
  const [showOwnerKey, setShowOwnerKey] = useState(false);

  useEffect(() => {
    try {
      setOwnerKey(localStorage.getItem(OWNER_GATE_KEY_STORAGE) ?? "");
    } catch {}
  }, []);

  const saveOwnerKey = (value: string) => {
    setOwnerKey(value);
    try {
      if (value.trim()) localStorage.setItem(OWNER_GATE_KEY_STORAGE, value.trim());
      else localStorage.removeItem(OWNER_GATE_KEY_STORAGE);
    } catch {}
  };

  const isAdmin = isWebsiteAdmin(user?.username);
  const displayName = userDisplayName(user) ?? "JayJoice";
  const avatarUrl = toMaxQualityAvatarUrl(user?.avatarUrl ?? undefined) || null;

  const isMatch = useMemo(() => {
    if (!isAdmin) return false;
    if (!searchQuery?.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return SEARCH_KEYS.some((k) =>
      getTranslationsForAllLocales(k).some((txt) => txt.toLowerCase().includes(q)),
    );
  }, [searchQuery, isAdmin]);

  if (!isAdmin || !isMatch) return null;

  const trimmed = message.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= MESSAGE_MAX && !sending;

  const handleSend = async () => {
    if (!canSend) {
      if (trimmed.length === 0) toast(t("settings.announcement.error_empty"), "error");
      return;
    }
    setSending(true);
    try {
      // null is fine — the website admin cookie can vouch for the browser
      // when the Liner session is dead (the server decides, not the client)
      const accessToken = await getValidAccessToken().catch(() => null);
      await sendAnnouncement(trimmed, accessToken, 15_000, ownerKey);
      setMessage("");
      setConfirmOpen(true);
    } catch (err) {
      if (err instanceof AnnouncementError) {
        if (err.code === "unauthorized") {
          toast(t("settings.announcement.error_unauthorized"), "error");
        } else if (err.code === "forbidden") {
          toast(t("settings.announcement.error_forbidden"), "error");
        } else if (err.code === "rate_limited") {
          toast(t("settings.announcement.error_rate_limited"), "error");
        } else if (err.code === "unreachable") {
          toast(t("settings.announcement.error_unreachable"), "error");
        } else {
          toast(t("settings.announcement.error_generic"), "error");
        }
      } else {
        toast(t("settings.announcement.error_generic"), "error");
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-[22px]">
      <SettingSection label={t("settings.announcement.section_title")}>
        <div className="flex flex-col gap-[12px] rounded-[12px] bg-black/[0.04] px-[16px] py-[16px] dark:bg-white/[0.08]">
          <p className="m-0 text-[13px] leading-[1.5] text-text-secondary" style={font}>
            {t("settings.announcement.section_subtitle")}
          </p>

          {/* how the popup header will look for everyone */}
          <div className="flex items-center gap-[12px] rounded-[12px] border border-border-primary/60 bg-bg-primary/60 px-[14px] py-[10px]">
            <UserAvatar
              user={{ avatarUrl, displayName, username: user?.username }}
              size={38}
              className="!rounded-[12px]"
            />
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-montserrat text-[14px] font-[700] leading-tight text-text-primary">
                {t("announcement.title_prefix")} {displayName}
              </span>
              <span
                className="truncate text-[12px] leading-tight text-text-tertiary"
                style={font}
              >
                @{user?.username ?? ""}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-[4px]">
            <label
              htmlFor="announcement-message"
              className="text-[14px] font-[500] leading-snug text-text-primary"
            >
              {t("settings.announcement.message_label")}
            </label>
            <div className="rounded-md border border-border-primary bg-bg-primary transition-[border-color] duration-150 focus-within:border-border-alpha-33">
              <textarea
                id="announcement-message"
                value={message}
                maxLength={MESSAGE_MAX}
                rows={4}
                placeholder={t("settings.announcement.message_placeholder")}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                disabled={sending}
                className="w-full resize-none border-0 bg-transparent px-[12px] py-[9px] text-[13px] text-text-primary outline-none placeholder:text-text-tertiary disabled:cursor-not-allowed"
                style={font}
              />
              <div className="flex justify-end px-[10px] pb-[6px]">
                <span
                  className={`text-[11px] select-none ${
                    message.length > MESSAGE_MAX
                      ? "text-accent-primary"
                      : "text-text-tertiary"
                  }`}
                  style={font}
                >
                  {message.length}/{MESSAGE_MAX}
                </span>
              </div>
            </div>
          </div>

          {/* owner gate key — unlocks broadcasting on hosts where the upstream
              is unreachable (the key proves possession of ADMIN_GATE_SECRET;
              the first success mints the website admin cookie, so it is only
              needed once per browser) */}
          <div className="flex flex-col gap-[4px]">
            <label
              htmlFor="announcement-owner-key"
              className="text-[14px] font-[500] leading-snug text-text-primary"
            >
              {t("settings.announcement.owner_key_label")}
            </label>
            <div className="flex items-center gap-[8px] rounded-md border border-border-primary bg-bg-primary pr-[10px] transition-[border-color] duration-150 focus-within:border-border-alpha-33">
              <input
                id="announcement-owner-key"
                type={showOwnerKey ? "text" : "password"}
                value={ownerKey}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("settings.announcement.owner_key_placeholder")}
                onChange={(e) => saveOwnerKey(e.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent px-[12px] py-[9px] text-[13px] text-text-primary outline-none placeholder:text-text-tertiary"
                style={font}
              />
              <button
                type="button"
                onClick={() => setShowOwnerKey((v) => !v)}
                className="shrink-0 cursor-pointer border-0 bg-transparent text-[11px] text-text-tertiary outline-none hover:text-text-secondary"
                style={font}
              >
                {showOwnerKey ? t("settings.announcement.owner_key_hide") : t("settings.announcement.owner_key_show")}
              </button>
            </div>
            <span className="text-[11px] leading-snug text-text-tertiary" style={font}>
              {t("settings.announcement.owner_key_hint")}
            </span>
          </div>

          <div className="flex items-center justify-between gap-[10px]">
            <span className="text-[12px] text-text-tertiary" style={font}>
              {t("settings.announcement.shortcut_hint")}
            </span>
            <Button onClick={() => void handleSend()} disabled={!canSend} size="sm">
              <span className="flex items-center gap-[6px]">
                {sending ? (
                  <span
                    aria-hidden
                    className="inline-block h-[14px] w-[14px] shrink-0 rounded-full border-[2px] border-current border-t-transparent opacity-70 animate-spin"
                  />
                ) : null}
                {sending
                  ? t("settings.announcement.sending")
                  : t("settings.announcement.send")}
              </span>
            </Button>
          </div>
        </div>
      </SettingSection>

      {/* post-submit reminder — for the site owner only, per the broadcast flow */}
      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) setConfirmOpen(false);
        }}
        maxWidth={360}
      >
        <div className="flex flex-col gap-[16px] px-[20px] pb-[20px]">
          <DialogHeader
            title={t("settings.announcement.confirm_title")}
            description={t("settings.announcement.confirm_body")}
          />
          <DialogActions>
            <DialogButton
              variant="secondary"
              className="!border-0 !bg-white !text-black hover:!bg-white/90 dark:!bg-white dark:!text-black"
              onClick={() => setConfirmOpen(false)}
            >
              {t("settings.announcement.okay")}
            </DialogButton>
          </DialogActions>
        </div>
      </Dialog>
    </div>
  );
}
