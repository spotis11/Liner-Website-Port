import { useCallback, useEffect, useMemo, useState } from "react";
import { LuDownload, LuPlay, LuTrash2 } from "react-icons/lu";
import { linerDb } from "@/shared/storage";
import type { Track } from "@/shared/types";
import { playerEngine } from "@/features/player/engine/playerEngine";
import { downloadManager } from "../lib/downloadManager";
import type { DownloadMeta } from "../lib/downloadManager";
import { useDownloadsStore } from "../store/downloadsStore";
import { usePageBackdrop } from "@/shared/lib";
import { useTranslation } from "@/languages";
import { showToast } from "@/shared/ui";

interface DownloadListItem {
  meta: DownloadMeta;
  sizeBytes: number;
  downloadedAt: number;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** index;
  return `${value >= 100 || index <= 1 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export default function DownloadsPage() {
  const { t } = useTranslation();
  usePageBackdrop?.();
  const statuses = useDownloadsStore((state) => state.statuses);
  const hydrate = useDownloadsStore((state) => state.hydrate);

  const [items, setItems] = useState<DownloadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [storageUsed, setStorageUsed] = useState<number | null>(null);

  const inFlight = useMemo(
    () =>
      Object.entries(statuses).filter(
        ([, state]) =>
          state.status === "downloading" || state.status === "queued",
      ),
    [statuses],
  );

  const refresh = useCallback(async () => {
    const pinned = await linerDb.getPinnedAudioRecords();
    const list: DownloadListItem[] = [];
    for (const record of pinned) {
      const meta = await linerDb.getTrack(record.trackId);
      list.push({
        meta: {
          id: record.trackId,
          title: meta?.title ?? record.trackId,
          artists: meta?.artists ?? "",
          coverUrl: meta?.coverUrl,
          durationMs: meta?.durationMs,
        },
        sizeBytes: record.byteSize || record.blob?.size || 0,
        downloadedAt: record.pinnedAt ?? record.savedAt,
      });
    }
    list.sort((a, b) => b.downloadedAt - a.downloadedAt);
    setItems(list);

    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        setStorageUsed(estimate.usage ?? null);
      } catch {
        setStorageUsed(null);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void hydrate().then(() => refresh());
  }, [hydrate, refresh]);

  // new pins appear the moment a download finishes — pick them up live
  const downloadedSignature = useMemo(
    () =>
      Object.entries(statuses)
        .filter(([, state]) => state.status === "downloaded")
        .map(([id]) => id)
        .sort()
        .join(","),
    [statuses],
  );

  useEffect(() => {
    if (downloadedSignature) void refresh();
  }, [downloadedSignature, refresh]);

  const handlePlay = useCallback((meta: DownloadMeta) => {
    const track: Track = {
      id: meta.id,
      title: meta.title,
      artists: meta.artists,
      coverUrl: meta.coverUrl ?? "",
      durationMs: meta.durationMs ?? 0,
      playCount: 0,
    };
    void playerEngine.playTrack(track, [track]);
  }, []);

  const handleRemove = useCallback(
    (meta: DownloadMeta) => {
      void downloadManager.removeDownload(meta.id).then(() => {
        showToast(t("downloads.removed_toast"), "success", {
          description: meta.artists
            ? `${meta.title} — ${meta.artists}`
            : meta.title,
        });
        void refresh();
      });
    },
    [refresh, t],
  );

  const totalBytes = useMemo(
    () => items.reduce((sum, item) => sum + item.sizeBytes, 0),
    [items],
  );

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-6 pb-32 pt-6 md:px-10">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-3 text-[28px] font-bold text-text-primary">
                <LuDownload size={26} className="opacity-80" />
                {t("downloads.title")}
              </h1>
              <p className="mt-2 text-[14px] text-text-tertiary">
                {t("downloads.subtitle", {
                  count: String(items.length),
                  size: formatBytes(totalBytes),
                })}
                {storageUsed !== null
                  ? ` · ${t("downloads.storage_used", {
                      size: formatBytes(storageUsed),
                    })}`
                  : ""}
              </p>
            </div>
          </div>

          {inFlight.length > 0 && (
            <div className="mb-6 space-y-2">
              {inFlight.map(([id, state]) => {
                const percent =
                  state.total && state.received !== undefined
                    ? Math.min(
                        100,
                        Math.round((state.received / state.total) * 100),
                      )
                    : null;
                return (
                  <div
                    key={id}
                    className="flex items-center gap-4 rounded-xl border border-border bg-surface/60 px-4 py-3"
                  >
                    <span
                      aria-hidden
                      className="block h-4 w-4 animate-spin rounded-full border-2 border-text-secondary border-t-transparent"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] text-text-primary">
                        {state.title || id}
                      </p>
                      {state.artists ? (
                        <p className="truncate text-[12px] text-text-tertiary">
                          {state.artists}
                        </p>
                      ) : null}
                      {percent !== null && (
                        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-border">
                          <div
                            className="h-full rounded-full bg-green-500 transition-all duration-200"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 text-[12px] tabular-nums text-text-tertiary">
                      {percent !== null ? `${percent}%` : t("downloads.preparing")}
                    </span>
                    <button
                      type="button"
                      onClick={() => downloadManager.cancel(id)}
                      className="shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-1 text-text-secondary hover:text-text-primary"
                      aria-label={t("common.cancel_download")}
                    >
                      <LuTrash2 size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {!loading && items.length === 0 && inFlight.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
              <LuDownload size={40} className="mb-4 text-text-tertiary opacity-50" />
              <p className="text-[16px] font-medium text-text-primary">
                {t("downloads.empty_title")}
              </p>
              <p className="mt-2 max-w-md text-[13px] text-text-tertiary">
                {t("downloads.empty_hint")}
              </p>
            </div>
          )}

          {items.length > 0 && (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.meta.id}
                  className="group flex items-center gap-4 rounded-xl border border-border bg-surface/60 px-4 py-3 transition-colors hover:bg-surface"
                >
                  <button
                    type="button"
                    onClick={() => handlePlay(item.meta)}
                    className="relative h-12 w-12 shrink-0 cursor-pointer overflow-hidden rounded-lg bg-border"
                    aria-label={t("common.play")}
                  >
                    {item.meta.coverUrl ? (
                      <img
                        src={item.meta.coverUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : null}
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                      <LuPlay size={18} className="text-white" />
                    </span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-text-primary">
                      {item.meta.title}
                    </p>
                    <p className="truncate text-[12px] text-text-tertiary">
                      {item.meta.artists || "—"}
                    </p>
                  </div>
                  <span className="shrink-0 text-[12px] tabular-nums text-text-tertiary">
                    {formatBytes(item.sizeBytes)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemove(item.meta)}
                    className="shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-1 text-text-secondary opacity-0 transition-all hover:text-red-500 group-hover:opacity-100"
                    aria-label={t("common.remove_download")}
                  >
                    <LuTrash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
