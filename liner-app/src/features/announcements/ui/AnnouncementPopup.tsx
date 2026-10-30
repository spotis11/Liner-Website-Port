import { useEffect } from "react";
import Dialog from "@/shared/ui/Dialog";
import { DialogActions, DialogButton, UserAvatar } from "@/shared/ui";
import { useTranslation } from "@/languages";
import { toMaxQualityAvatarUrl } from "@/shared/api";
import { useAnnouncementStore } from "../store/announcementStore";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

/**
 * Global announcement popup, shown to everyone on the website while an
 * announcement is inside its 60-second live window:
 *
 *   Announcement From JayJoice (profile pic)
 *   <message>
 *   this message will be gone within 1 minute   (small text)
 *   [ Okay ]                                    (white button)
 */
export function AnnouncementPopup() {
  const { t } = useTranslation();
  const active = useAnnouncementStore((s) => s.active);
  const start = useAnnouncementStore((s) => s.start);
  const stop = useAnnouncementStore((s) => s.stop);
  const dismiss = useAnnouncementStore((s) => s.dismiss);

  useEffect(() => {
    start();
    return () => stop();
  }, [start, stop]);

  if (!active) return null;

  const sender = {
    avatarUrl: toMaxQualityAvatarUrl(active.senderAvatarUrl ?? undefined) || null,
    displayName: active.senderName,
    username: active.senderUsername,
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
      maxWidth={380}
      // above the fullscreen player (z-99) and toasts, below regular dialogs (z-199/200)
      zIndex={150}
    >
      <div className="flex flex-col gap-[14px] px-[20px] pb-[20px] pt-[20px]">
        <div className="flex min-w-0 items-center gap-[12px]">
          <UserAvatar user={sender} size={44} className="!rounded-[14px]" />
          <div className="flex min-w-0 flex-col gap-[1px]">
            <span className="truncate font-montserrat text-[15px] font-[700] leading-tight text-text-primary">
              {t("announcement.title_prefix")} {active.senderName}
            </span>
            <span
              className="truncate text-[12px] leading-tight text-text-tertiary"
              style={font}
            >
              @{active.senderUsername}
            </span>
          </div>
        </div>

        <p
          className="m-0 whitespace-pre-wrap break-words text-[14px] leading-[1.55] text-text-primary"
          style={font}
        >
          {active.message}
        </p>

        <p className="m-0 text-[11px] leading-snug text-text-tertiary" style={font}>
          {t("announcement.expires_note")}
        </p>

        <DialogActions>
          <DialogButton
            variant="secondary"
            className="!border-0 !bg-white !text-black hover:!bg-white/90 dark:!bg-white dark:!text-black"
            onClick={dismiss}
          >
            {t("announcement.okay")}
          </DialogButton>
        </DialogActions>
      </div>
    </Dialog>
  );
}

export default AnnouncementPopup;
