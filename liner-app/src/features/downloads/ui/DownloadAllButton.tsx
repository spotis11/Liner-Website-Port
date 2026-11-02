import { useCallback, useEffect, useMemo } from "react";
import { LuDownload, LuCheck } from "react-icons/lu";
import { downloadManager } from "../lib/downloadManager";
import type { DownloadMeta } from "../lib/downloadManager";
import { useDownloadsStore } from "../store/downloadsStore";
import { showToast } from "@/shared/ui";
import Button from "@/shared/ui/Button";
import {
  HERO_BUTTON_CLASS,
  HERO_GLASS_BUTTON_CLASS,
} from "@/shared/ui/EntityHero";
import { useTranslation } from "@/languages";
import { cn } from "@/shared/lib";

export interface DownloadAllButtonProps {
  /**
   * The collection's tracks. Only a minimal shape is needed (id, title,
   * artists) so playlist tracks, album tracks and queue items can all be
   * passed straight through. Local files are skipped automatically.
   */
  tracks: DownloadMeta[];
  /** hero = labelled glass button for page heroes, icon = compact header action */
  variant?: "hero" | "icon";
  className?: string;
  disabled?: boolean;
}

/**
 * One-tap "download everything here": batches Liked Songs, a whole playlist,
 * an album or the entire play queue into pinned offline storage. Skips songs
 * that are already saved, shows live n/m progress while the batch drains, and
 * flips to a green check once every song is on the device.
 */
export function DownloadAllButton({
  tracks,
  variant = "hero",
  className,
  disabled = false,
}: DownloadAllButtonProps) {
  const { t } = useTranslation();
  const statuses = useDownloadsStore((state) => state.statuses);
  const hydrate = useDownloadsStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const eligible = useMemo(
    () =>
      tracks.filter(
        (track): track is DownloadMeta =>
          Boolean(track?.id) && !track.id.startsWith("local:"),
      ),
    [tracks],
  );

  const { total, downloaded, busy } = useMemo(() => {
    let downloadedCount = 0;
    let busyCount = 0;
    for (const track of eligible) {
      const status = statuses[track.id]?.status;
      if (status === "downloaded") downloadedCount += 1;
      else if (status === "queued" || status === "downloading") busyCount += 1;
    }
    return {
      total: eligible.length,
      downloaded: downloadedCount,
      busy: busyCount > 0,
    };
  }, [eligible, statuses]);

  const allDownloaded = total > 0 && downloaded === total;

  const onClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (disabled) return;

      if (allDownloaded) {
        showToast(t("downloads.all_downloaded_toast"), "success", {
          description: t("common.songs", { count: total }),
        });
        return;
      }

      void downloadManager.downloadMany(eligible).then((queuedCount) => {
        if (queuedCount > 0) {
          showToast(
            t("downloads.batch_started_toast", { count: queuedCount }),
            "success",
            { description: t("common.songs", { count: total }) },
          );
        } else {
          showToast(t("downloads.all_downloaded_toast"), "success");
        }
      });
    },
    [disabled, allDownloaded, eligible, total, t],
  );

  if (variant === "icon") {
    const iconLabel = allDownloaded
      ? t("downloads.downloaded_all")
      : busy
        ? t("downloads.downloading_progress", { done: downloaded, total })
        : t("downloads.download_all");

    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || total === 0}
        aria-label={iconLabel}
        title={iconLabel}
        className={cn(
          "inline-flex h-[32px] w-[36px] shrink-0 cursor-pointer items-center justify-center rounded-[7px] border-0 bg-transparent p-0 transition-[background-color,color,transform] duration-150 active:scale-[0.94] disabled:cursor-default disabled:opacity-35 disabled:active:scale-100",
          allDownloaded
            ? "text-green-500 hover:bg-white/[0.08]"
            : "text-text-secondary hover:bg-white/[0.08] hover:text-text-primary",
          className,
        )}
      >
        {busy ? (
          <span className="text-[10px] leading-none font-[500] tabular-nums">
            {downloaded}/{total}
          </span>
        ) : allDownloaded ? (
          <LuCheck size={17} />
        ) : (
          <LuDownload size={17} />
        )}
      </button>
    );
  }

  const progressLabel = t("downloads.downloading_progress", {
    done: downloaded,
    total,
  });

  return (
    <Button
      variant="secondary"
      onClick={onClick}
      disabled={disabled || total === 0}
      className={`${HERO_BUTTON_CLASS} ${HERO_GLASS_BUTTON_CLASS} px-[18px] ${
        allDownloaded ? "!text-green-500" : ""
      }`}
      title={allDownloaded ? t("downloads.downloaded_all") : progressLabel}
    >
      {busy ? (
        <>
          <span
            aria-hidden
            className="block h-[14px] w-[14px] shrink-0 animate-spin rounded-full border-[2px] border-current border-t-transparent"
          />
          <span className="tabular-nums">{progressLabel}</span>
        </>
      ) : allDownloaded ? (
        <>
          <LuCheck size={16} />
          <span className="truncate">{t("downloads.downloaded_all")}</span>
        </>
      ) : (
        <>
          <LuDownload size={16} />
          <span className="truncate">{t("downloads.download_all")}</span>
        </>
      )}
    </Button>
  );
}

export default DownloadAllButton;
