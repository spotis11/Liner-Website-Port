import { useCallback, useEffect } from "react";
import { LuDownload, LuCheck } from "react-icons/lu";
import { downloadManager } from "../lib/downloadManager";
import type { DownloadMeta } from "../lib/downloadManager";
import { useDownloadsStore } from "../store/downloadsStore";
import { showToast } from "@/shared/ui";
import { useTranslation } from "@/languages";
import { cn } from "@/shared/lib";

export interface TrackDownloadButtonProps {
  track: DownloadMeta;
  className?: string;
}

/**
 * Row-level offline download control: idle → tap to download, in-flight →
 * tap to cancel (shows progress), downloaded → tap to remove. Mirrors the
 * like-heart hover behaviour so rows stay visually consistent.
 */
export function TrackDownloadButton({ track, className }: TrackDownloadButtonProps) {
  const { t } = useTranslation();
  const status = useDownloadsStore((state) => state.statuses[track.id]);
  const hydrate = useDownloadsStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const onClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const current = useDownloadsStore.getState().statuses[track.id];
      const state = current?.status ?? "idle";

      if (state === "downloading" || state === "queued") {
        downloadManager.cancel(track.id);
        return;
      }

      if (state === "downloaded") {
        void downloadManager.removeDownload(track.id).then(() => {
          showToast(t("downloads.removed_toast"), "success", {
            description: track.artists
              ? `${track.title} — ${track.artists}`
              : track.title,
          });
        });
        return;
      }

      void downloadManager.downloadTrack(track).catch((error: Error) => {
        showToast(t("downloads.failed_toast"), "error", {
          description: error?.message || track.title,
        });
      });
    },
    [track, t],
  );

  const label =
    status?.status === "downloaded"
      ? t("common.remove_download")
      : status?.status === "downloading" || status?.status === "queued"
        ? t("common.cancel_download")
        : t("common.download");

  if (status?.status === "downloaded") {
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        data-prevent-drag
        onClick={onClick}
        className={cn(
          "flex shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-green-500 transition-all duration-200 active:scale-[0.9]",
          className,
        )}
      >
        <LuCheck size={17} />
      </button>
    );
  }

  if (status?.status === "downloading" || status?.status === "queued") {
    const total = status.total;
    const percent =
      total && status.received !== undefined
        ? Math.min(100, Math.round((status.received / total) * 100))
        : null;
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        data-prevent-drag
        onClick={onClick}
        className={cn(
          "flex shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-text-secondary transition-all duration-200 hover:text-text-primary active:scale-[0.9]",
          className,
        )}
      >
        {percent !== null ? (
          <span className="text-[10px] leading-none tabular-nums">{percent}</span>
        ) : (
          <span
            aria-hidden
            className="block h-[13px] w-[13px] animate-spin rounded-full border-[2px] border-current border-t-transparent"
          />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-prevent-drag
      onClick={onClick}
      className={cn(
        "flex shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-text-secondary opacity-0 transition-all duration-200 hover:text-text-primary focus-visible:opacity-100 active:scale-[0.9] group-hover:opacity-100",
        status?.status === "error" && "text-red-500 opacity-100",
        className,
      )}
    >
      <LuDownload size={17} />
    </button>
  );
}

export default TrackDownloadButton;
