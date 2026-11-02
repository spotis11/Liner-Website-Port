import { useMemo, useRef, useState } from "react";
import {
  Camera2Line,
  Delete2Line,
  LockLine,
  MailLine,
  SafeAlertLine,
  User3Line,
} from "@mingcute/react";
import { useTranslation } from "@/languages";
import Button from "@/shared/ui/Button";
import TextInput from "@/shared/ui/TextInput";
import ToggleSwitch from "@/shared/ui/ToggleSwitch";
import { UserAvatar, useToast } from "@/shared/ui";
import { useAuthStore } from "@/features/auth";
import { ApiError, type UpdateProfileInput } from "@/shared/api";
import { userDisplayName } from "@/entities/user";
import { SettingRow, SettingSection } from "../controls";
import {
  AVATAR_ACCEPTED_TYPES,
  AvatarProcessException,
  fileToAvatarDataUrl,
  isAcceptableAvatarFile,
} from "../../lib/avatarImage";

const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;
const DISPLAY_NAME_MAX = 60;
const BIO_MAX = 500;

type UsernameError = "invalid" | "taken" | null;

export function AccountTab({ searchQuery }: { searchQuery?: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [usernameError, setUsernameError] = useState<UsernameError>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const [privacyBusy, setPrivacyBusy] = useState<string | null>(null);

  const isPublic = user?.isPublic ?? true;
  const showActivity = user?.showActivity ?? true;
  const showHistory = user?.showHistory ?? true;
  const showLikedTracks = user?.showLikedTracks ?? false;
  const participateLeaderboards = user?.participateLeaderboards ?? true;

  const original = {
    displayName: user?.displayName ?? "",
    username: user?.username ?? "",
    bio: user?.bio ?? "",
  };
  const normalizedUsername = username.trim().toLowerCase();
  const dirty = useMemo(
    () =>
      displayName.trim() !== original.displayName ||
      normalizedUsername !== original.username ||
      bio.trim() !== original.bio,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayName, normalizedUsername, bio, user?.displayName, user?.username, user?.bio],
  );

  if (!user) {
    return (
      <div className="flex flex-col items-center gap-[10px] py-[48px] text-center">
        <User3Line size={36} className="text-text-tertiary" />
        <p className="text-text-secondary text-[14px] m-0">
          {t("settings.profile.not_signed_in")}
        </p>
      </div>
    );
  }

  const usernameLocallyInvalid =
    normalizedUsername.length > 0 && !USERNAME_PATTERN.test(normalizedUsername);
  const canSave =
    dirty && !saving && !usernameLocallyInvalid && usernameError === null;

  const discard = () => {
    setDisplayName(original.displayName);
    setUsername(original.username);
    setBio(original.bio);
    setUsernameError(null);
  };

  const applyUsernameError = (error: unknown): boolean => {
    if (error instanceof ApiError) {
      if (error.code === "USERNAME_TAKEN") {
        setUsernameError("taken");
        return true;
      }
      if (error.code === "INVALID_USERNAME") {
        setUsernameError("invalid");
        return true;
      }
    }
    return false;
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setUsernameError(null);
    try {
      const nextDisplayName = displayName.trim().slice(0, DISPLAY_NAME_MAX);
      const patch: UpdateProfileInput = {
        displayName: nextDisplayName || null,
        bio: bio.trim() ? bio.trim().slice(0, BIO_MAX) : null,
      };
      if (normalizedUsername !== original.username) {
        patch.username = normalizedUsername;
      }
      await updateProfile(patch);
      setSavedTick((tick) => tick + 1);
      toast(t("settings.profile.saved_success"), "success");
    } catch (error) {
      if (!applyUsernameError(error)) {
        toast(t("settings.profile.save_failed"), "error");
      }
    } finally {
      setSaving(false);
    }
  };

  const pickAvatar = () => fileInputRef.current?.click();

  const onFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || avatarBusy) return;
    if (!isAcceptableAvatarFile(file)) {
      toast(t("settings.profile.avatar_invalid"), "error");
      return;
    }
    setAvatarBusy(true);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      await updateProfile({ avatarUrl: dataUrl });
      toast(t("settings.profile.avatar_updated"), "success");
    } catch (error) {
      if (error instanceof AvatarProcessException) {
        const key =
          error.reason === "too_large"
            ? "settings.profile.avatar_too_large"
            : error.reason === "invalid_type"
              ? "settings.profile.avatar_invalid"
              : "settings.profile.avatar_failed";
        toast(t(key), "error");
      } else if (!applyUsernameError(error)) {
        toast(t("settings.profile.save_failed"), "error");
      }
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    if (avatarBusy || !user.avatarUrl) return;
    setAvatarBusy(true);
    try {
      await updateProfile({ avatarUrl: null });
      toast(t("settings.profile.avatar_removed"), "success");
    } catch {
      toast(t("settings.profile.save_failed"), "error");
    } finally {
      setAvatarBusy(false);
    }
  };

  const patchPrivacy = async (
    buildPatch: (value: boolean) => UpdateProfileInput,
    busyKey: string,
    value: boolean,
  ) => {
    setPrivacyBusy(busyKey);
    try {
      await updateProfile(buildPatch(value));
    } catch {
      // store keeps the previous user object when the request fails,
      // so the toggle flips back on its own on the next render
      toast(t("settings.profile.save_failed"), "error");
    } finally {
      setPrivacyBusy(null);
    }
  };

  const openSupport = () => {
    window.open("https://t.me/liner_app?direct", "_blank", "noopener,noreferrer");
  };

  const email = user.email ?? "";
  const name = userDisplayName(user) ?? t("settings.profile.title");
  const handle = user.username ? `@${user.username}` : email;

  const privacyRows: {
    field: string;
    buildPatch: (value: boolean) => UpdateProfileInput;
    value: boolean;
    titleKey: string;
    descKey: string;
    icon: React.ReactNode;
  }[] = [
    {
      field: "isPublic",
      buildPatch: (value) => ({ isPublic: value }),
      value: isPublic,
      titleKey: "settings.profile.public_profile.title",
      descKey: "settings.profile.public_profile.description",
      icon: <User3Line size={20} />,
    },
    {
      field: "showActivity",
      buildPatch: (value) => ({ showActivity: value }),
      value: showActivity,
      titleKey: "settings.profile.show_activity.title",
      descKey: "settings.profile.show_activity.description",
      icon: <SafeAlertLine size={20} />,
    },
    {
      field: "showHistory",
      buildPatch: (value) => ({ showHistory: value }),
      value: showHistory,
      titleKey: "settings.profile.show_history.title",
      descKey: "settings.profile.show_history.description",
      icon: <SafeAlertLine size={20} />,
    },
    {
      field: "showLikedTracks",
      buildPatch: (value) => ({ showLikedTracks: value }),
      value: showLikedTracks,
      titleKey: "settings.profile.show_liked_tracks.title",
      descKey: "settings.profile.show_liked_tracks.description",
      icon: <SafeAlertLine size={20} />,
    },
    {
      field: "participateLeaderboards",
      buildPatch: (value) => ({ participateLeaderboards: value }),
      value: participateLeaderboards,
      titleKey: "settings.profile.participate_leaderboards.title",
      descKey: "settings.profile.participate_leaderboards.description",
      icon: <SafeAlertLine size={20} />,
    },
  ];

  return (
    <div className="flex flex-col gap-[22px]">
      <input
        ref={fileInputRef}
        type="file"
        accept={AVATAR_ACCEPTED_TYPES}
        className="hidden"
        onChange={onFileInputChange}
        data-testid="account-avatar-input"
      />

      {!searchQuery?.trim() && (
        <div className="rounded-[12px] bg-black/[0.04] px-[16px] py-[16px] dark:bg-white/[0.08] flex items-center gap-[16px] flex-wrap">
          <button
            type="button"
            onClick={pickAvatar}
            disabled={avatarBusy}
            title={t("settings.profile.avatar_change")}
            aria-label={t("settings.profile.avatar_change")}
            className="relative rounded-[16px] border-0 bg-transparent p-0 cursor-pointer group shrink-0 disabled:cursor-wait"
          >
            <UserAvatar user={user} size={72} className="!rounded-[16px]" />
            <span className="absolute inset-0 rounded-[16px] bg-black/45 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity flex items-center justify-center text-white">
              <Camera2Line size={22} />
            </span>
            {avatarBusy && (
              <span className="absolute inset-0 rounded-[16px] bg-black/45 flex items-center justify-center text-white">
                <span className="w-[18px] h-[18px] rounded-full border-2 border-white/40 border-t-white animate-spin" />
              </span>
            )}
          </button>
          <div className="flex-1 min-w-[160px] flex flex-col gap-[2px]">
            <span className="text-text-primary text-[16px] font-[600] leading-tight">
              {name}
            </span>
            <span className="text-text-tertiary text-[13px] truncate">
              {handle}
            </span>
            {email && (
              <span className="text-text-tertiary text-[12px] truncate flex items-center gap-[6px] mt-[2px]">
                <MailLine size={13} className="shrink-0" />
                {email}
              </span>
            )}
          </div>
          <div className="flex items-center gap-[8px]">
            <Button
              variant="secondary"
              size="sm"
              onClick={pickAvatar}
              disabled={avatarBusy}
            >
              <span className="flex items-center gap-[6px]">
                <Camera2Line size={15} />
                {t("settings.profile.avatar_change")}
              </span>
            </Button>
            {user.avatarUrl && (
              <Button
                variant="ghost"
                size="sm"
                onClick={removeAvatar}
                disabled={avatarBusy}
              >
                <span className="flex items-center gap-[6px]">
                  <Delete2Line size={15} />
                  {t("settings.profile.avatar_remove")}
                </span>
              </Button>
            )}
          </div>
        </div>
      )}

      <SettingSection
        label={t("settings.profile.details_section")}
      >
        <div className="rounded-[12px] bg-black/[0.04] px-[16px] py-[13px] dark:bg-white/[0.08] flex flex-col gap-[10px]">
          <div className="flex flex-col gap-[4px]">
            <label
              htmlFor="account-display-name"
              className="text-text-primary text-[14px] font-[500] leading-snug"
            >
              {t("settings.profile.display_name_label")}
            </label>
            <TextInput
              id="account-display-name"
              size="sm"
              value={displayName}
              maxLength={DISPLAY_NAME_MAX}
              placeholder={t("settings.profile.display_name_placeholder")}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="flex flex-col gap-[4px]">
            <label
              htmlFor="account-username"
              className="text-text-primary text-[14px] font-[500] leading-snug"
            >
              {t("settings.profile.username_label")}
            </label>
            <TextInput
              id="account-username"
              size="sm"
              value={username}
              maxLength={30}
              spellCheck={false}
              autoComplete="off"
              placeholder={t("settings.profile.username_label")}
              hasError={usernameLocallyInvalid || usernameError !== null}
              onChange={(e) => {
                setUsername(e.target.value);
                setUsernameError(null);
              }}
              onBlur={() =>
                setUsername((value) => value.trim().toLowerCase())
              }
              disabled={saving}
            />
            {usernameLocallyInvalid || usernameError === "invalid" ? (
              <span className="text-[12px] leading-[1.4] text-accent-primary">
                {t("settings.profile.username_invalid")}
              </span>
            ) : usernameError === "taken" ? (
              <span className="text-[12px] leading-[1.4] text-accent-primary">
                {t("settings.profile.username_taken")}
              </span>
            ) : (
              <span className="text-text-tertiary text-[12px] leading-[1.4]">
                {t("settings.profile.username_hint")}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-[4px]">
            <label
              htmlFor="account-bio"
              className="text-text-primary text-[14px] font-[500] leading-snug"
            >
              {t("settings.profile.bio_label")}
            </label>
            <textarea
              id="account-bio"
              value={bio}
              maxLength={BIO_MAX}
              rows={3}
              placeholder={t("settings.profile.bio_placeholder")}
              onChange={(e) => setBio(e.target.value)}
              disabled={saving}
              className="w-full rounded-md border border-border-primary bg-bg-primary px-[12px] py-[9px] text-[13px] text-text-primary placeholder:text-text-tertiary outline-none focus-within:border-border-alpha-33 resize-none disabled:opacity-50 transition-[border-color] duration-150"
              style={{ fontFamily: "var(--font-inter), sans-serif" }}
            />
          </div>

          <div className="flex items-center gap-[8px] pt-[2px]">
            <Button
              variant="primary"
              size="sm"
              onClick={save}
              disabled={!canSave}
            >
              {saving
                ? t("settings.profile.saving")
                : t("settings.profile.save_changes")}
            </Button>
            {dirty && (
              <Button
                variant="ghost"
                size="sm"
                onClick={discard}
                disabled={saving}
              >
                {t("settings.profile.reset_changes")}
              </Button>
            )}
            {!dirty && savedTick > 0 && (
              <span className="text-text-tertiary text-[12px]">
                {t("settings.profile.saved_success")}
              </span>
            )}
          </div>
        </div>
      </SettingSection>

      <SettingSection
        label={t("settings.profile.privacy_section")}
      >
        {privacyRows.map((row) => (
          <SettingRow
            key={row.field}
            title={t(row.titleKey)}
            description={t(row.descKey)}
            explained
            icon={row.icon}
            titleKey={row.titleKey}
            descKey={row.descKey}
            searchQuery={searchQuery}
            control={
              <ToggleSwitch
                checked={row.value}
                disabled={privacyBusy === row.field}
                onChange={(next) =>
                  void patchPrivacy(row.buildPatch, row.field, next)
                }
              />
            }
          />
        ))}
      </SettingSection>

      <SettingSection
        label={t("settings.profile.security_section")}
      >
        <SettingRow
          title={t("settings.profile.change_password")}
          description={t("settings.profile.password_note")}
          explained
          icon={<LockLine size={20} />}
          titleKey="settings.profile.change_password"
          descKey="settings.profile.password_note"
          searchQuery={searchQuery}
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={openSupport}
            >
              {t("settings.profile.contact_support")}
            </Button>
          }
        />
      </SettingSection>
    </div>
  );
}
