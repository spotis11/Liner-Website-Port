// Liner web port: Local Music page (/local).
//
// Recreated from the shipped bundle (untracked source lost — worklog Task 26).
// Scan local folders (File System Access API) or drag & drop audio files,
// filter/sort the library, play rows through the shared player engine —
// localFileId tracks stream straight from IndexedDB, fully offline.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Delete2Line,
  FileUploadLine,
  Folder2Fill,
  Folder2Line,
  FolderOpenLine,
  Music2Line,
  NewFolderLine,
  Refresh2Line,
  Search2Line,
  AZSortAscendingLettersLine,
} from "@mingcute/react";
import { useTranslation } from "@/languages";
import { usePageBackdrop } from "@/shared/lib/pageBackdrop";
import { playerEngine } from "@/features/player/engine/playerEngine";
import { usePlayerState } from "@/features/player/hooks/usePlayerState";
import {
  sortTracks,
  toPlayerTrack,
  useLocalMusicStore,
  type LocalSortId,
} from "../store/localMusicStore";
import { hasFileSystemAccess } from "../lib/scan";
import type { Track } from "@/shared/types/track";

// visually hidden but NOT display:none — some engines refuse .click() on
// display:none file inputs; this stays clickable via user gesture handlers
const FILE_INPUT_HIDDEN =
  "absolute h-0 w-0 overflow-hidden opacity-0 pointer-events-none -z-10";

const ACCEPT = "audio/*,.mp3,.flac,.wav,.m4a,.aac,.ogg,.opus,.wma,.aiff";

const SORT_OPTIONS: { id: LocalSortId; key: string }[] = [
  { id: "title", key: "local.sort_title" },
  { id: "artist", key: "local.sort_artist" },
  { id: "album", key: "local.sort_album" },
  { id: "recent", key: "local.sort_recent" },
];

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "--:--";
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function LocalMusicPage() {
  const { t } = useTranslation();
  usePageBackdrop(undefined, { blur: 0, dim: 0 });

  const tracks = useLocalMusicStore((state) => state.tracks);
  const folders = useLocalMusicStore((state) => state.folders);
  const loading = useLocalMusicStore((state) => state.loading);
  const scanning = useLocalMusicStore((state) => state.scanning);
  const scanProgress = useLocalMusicStore((state) => state.scanProgress);
  const coverUrls = useLocalMusicStore((state) => state.coverUrls);
  const init = useLocalMusicStore((state) => state.init);
  const refresh = useLocalMusicStore((state) => state.refresh);
  const addFolder = useLocalMusicStore((state) => state.addFolder);
  const addDroppedFiles = useLocalMusicStore((state) => state.addDroppedFiles);
  useLocalMusicStore((state) => state.addPickedFiles);
  const addFilesList = useLocalMusicStore((state) => state.addFilesList);
  const rescanAll = useLocalMusicStore((state) => state.rescanAll);
  const removeFolder = useLocalMusicStore((state) => state.removeFolder);
  const removeTrack = useLocalMusicStore((state) => state.removeTrack);
  const getCoverUrl = useLocalMusicStore((state) => state.getCoverUrl);

  const player = usePlayerState();

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LocalSortId>("recent");
  const [dragging, setDragging] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const foldersRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const lastErrorRef = useRef<string | null>(null);

  const fsAccess = useMemo(() => hasFileSystemAccess(), []);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  // the store records failures silently — surface them as a toast so a dead
  // click never looks like a broken button
  const storeError = useLocalMusicStore((state) => state.error);
  useEffect(() => {
    if (storeError && storeError !== lastErrorRef.current) {
      lastErrorRef.current = storeError;
      setToast(t("local.scan_failed", { reason: storeError.slice(0, 80) }));
    }
  }, [storeError, t]);

  useEffect(() => {
    if (!foldersOpen) return;
    const onOutside = (event: MouseEvent) => {
      if (!foldersRef.current?.contains(event.target as Node)) setFoldersOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [foldersOpen]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const source = needle
      ? tracks.filter(
          (track) =>
            track.title.toLowerCase().includes(needle) ||
            track.artist.toLowerCase().includes(needle) ||
            (track.album ?? "").toLowerCase().includes(needle) ||
            (track.path ?? "").toLowerCase().includes(needle) ||
            track.fileName.toLowerCase().includes(needle),
        )
      : tracks;
    return sortTracks(source, sort);
  }, [tracks, query, sort]);

  const playerQueue = useMemo(
    () => visible.map(toPlayerTrack),
    [visible],
  );

  const playRow = useCallback(
    (index: number) => {
      const track: Track | undefined = playerQueue[index];
      if (track) playerEngine.playTrack(track, playerQueue, "local");
    },
    [playerQueue],
  );

  // warm object URLs for the first screenful of embedded covers
  useEffect(() => {
    for (const track of visible.slice(0, 60)) {
      if (!coverUrls[track.fileId]) void getCoverUrl(track.fileId);
    }
  }, [visible, coverUrls, getCoverUrl]);

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const added = await addDroppedFiles(event.dataTransfer);
      if (added > 0) setToast(t("local.files_added", { count: added }));
    },
    [addDroppedFiles, t],
  );

  const onAddFolder = useCallback(async () => {
    if (fsAccess) {
      if (await addFolder()) setFoldersOpen(true);
    } else {
      // Firefox/Safari: pick a real FOLDER via webkitdirectory (falls back to
      // the folder-input path; audio filtering happens in addFilesList)
      folderInputRef.current?.click();
    }
  }, [addFolder, fsAccess]);

  const onScanNow = useCallback(async () => {
    if (folders.length === 0) {
      setToast(t("local.scan_no_folders"));
      return;
    }
    try {
      const added = await rescanAll();
      setToast(t("local.scan_complete", { count: added > 0 ? added : 0 }));
    } catch (error) {
      setToast(t("local.scan_failed", { reason: String(error).slice(0, 80) }));
    }
  }, [rescanAll, t, folders.length]);

  const isCurrent = (id: string) => player.currentTrack?.id === id;

  return (
    <div
      className="relative flex h-full flex-col"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className={FILE_INPUT_HIDDEN}
        onChange={async (event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          const added = await addFilesList(files);
          if (added > 0) setToast(t("local.files_added", { count: added }));
        }}
      />
      {/* real folder picker for engines without the File System Access API
          (Firefox/Safari) — “Add Folder” opens this instead of a files-only
          picker; all files arrive and the store filters to audio */}
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className={FILE_INPUT_HIDDEN}
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={async (event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          const added = await addFilesList(files);
          setToast(
            added > 0
              ? t("local.files_added", { count: added })
              : t("local.scan_no_audio"),
          );
        }}
      />

      {/* header */}
      <div className="flex items-start justify-between gap-[16px] px-[22px] pt-[16px]">
        <div className="flex min-w-0 items-center gap-[14px]">
          <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl bg-[#e08c3f]/18 text-[#e08c3f]">
            <Folder2Fill size={26} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-[10px]">
              <h1 className="m-0 truncate text-[24px] font-[800] leading-[1.1] text-text-primary">
                {t("local.title")}
              </h1>
              <span className="shrink-0 rounded-full bg-border-alpha-14 px-[9px] py-[3px] text-[11px] font-[600] leading-none text-text-secondary">
                {t("local.tracks_count", { count: tracks.length })}
              </span>
            </div>
            <p className="m-0 mt-[3px] truncate text-[13px] text-text-tertiary">
              {t("local.subtitle")}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-[8px]">
          {/* folders popover */}
          <div className="relative" ref={foldersRef}>
            <button
              type="button"
              onClick={() => setFoldersOpen((open) => !open)}
              className="inline-flex h-[32px] items-center gap-[6px] rounded-lg border border-border-alpha-14 bg-black/[0.06] px-[12px] text-[12.5px] font-[600] text-text-primary transition-colors hover:bg-black/[0.1] dark:bg-white/[0.07] dark:hover:bg-white/[0.12]"
            >
              <Folder2Line size={16} />
              {t("local.folders")} ({folders.length})
            </button>
            <AnimatePresence>
              {foldersOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.14 }}
                  className="absolute right-0 top-[38px] z-40 w-[260px] rounded-xl border border-border-alpha-14 bg-bg-elevated p-[6px] shadow-[0_16px_48px_rgba(0,0,0,0.35)]"
                >
                  {folders.length === 0 ? (
                    <p className="m-0 px-[10px] py-[8px] text-[12.5px] text-text-tertiary">
                      {t("local.folders_none")}
                    </p>
                  ) : (
                    folders.map((folder) => (
                      <div
                        key={folder.id}
                        className="group flex items-center gap-[8px] rounded-lg px-[10px] py-[7px] hover:bg-border-alpha-14"
                      >
                        <Folder2Fill size={16} className="shrink-0 text-text-tertiary" />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                          {folder.name}
                        </span>
                        <button
                          type="button"
                          aria-label={t("local.remove")}
                          title={t("local.remove")}
                          onClick={() => void removeFolder(folder.id)}
                          className="inline-flex h-[24px] w-[24px] items-center justify-center rounded-md border-none bg-transparent text-text-tertiary opacity-0 transition-all hover:bg-black/10 hover:text-[#e05545] group-hover:opacity-100 dark:hover:bg-white/10"
                        >
                          <Delete2Line size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            type="button"
            onClick={onAddFolder}
            className="inline-flex h-[32px] items-center gap-[6px] rounded-lg border border-border-alpha-14 bg-black/[0.06] px-[12px] text-[12.5px] font-[600] text-text-primary transition-colors hover:bg-black/[0.1] dark:bg-white/[0.07] dark:hover:bg-white/[0.12]"
          >
            <NewFolderLine size={16} />
            {t("local.add_folder")}
          </button>
          <button
            type="button"
            disabled={scanning}
            onClick={onScanNow}
            className="inline-flex h-[32px] items-center gap-[6px] rounded-lg border-none bg-btn-primary-bg px-[12px] text-[12.5px] font-[700] text-btn-primary-text transition-all hover:opacity-90 disabled:opacity-60"
          >
            <Refresh2Line
              size={15}
              className={scanning ? "animate-spin" : ""}
            />
            {t(scanning ? "local.scanning" : "local.scan_now")}
          </button>
        </div>
      </div>

      {/* drop zone / file picker */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className={`mx-[22px] mt-[12px] flex h-[38px] shrink-0 items-center justify-center gap-[8px] rounded-xl border border-dashed text-[12.5px] transition-colors cursor-pointer ${
          dragging
            ? "border-[#e08c3f] bg-[#e08c3f]/12 text-text-primary"
            : "border-border-alpha-33 bg-black/[0.045] text-text-tertiary hover:bg-black/[0.075] dark:bg-white/[0.045] dark:hover:bg-white/[0.075]"
        }`}
      >
        <FileUploadLine size={16} />
        {t("local.drop_hint")}
      </button>

      {/* filter + sort */}
      <div className="mt-[12px] flex shrink-0 items-center gap-[12px] px-[22px]">
        <div className="relative min-w-0 flex-1">
          <Search2Line
            size={16}
            className="pointer-events-none absolute left-[12px] top-1/2 -translate-y-1/2 text-text-tertiary"
          />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("local.search_placeholder")}
            className="h-[34px] w-full rounded-lg border border-border-alpha-14 bg-black/[0.055] pl-[34px] pr-[12px] text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-alpha-33 dark:bg-white/[0.06]"
          />
        </div>
        <div className="flex shrink-0 items-center gap-[6px]">
          <AZSortAscendingLettersLine size={15} className="text-text-tertiary" />
          <div className="flex items-center rounded-lg bg-black/[0.055] p-[3px] dark:bg-white/[0.06]">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setSort(option.id)}
                className={`h-[24px] rounded-md border-none px-[10px] text-[12px] font-[600] transition-colors cursor-pointer ${
                  sort === option.id
                    ? "bg-border-alpha-33 text-text-primary"
                    : "bg-transparent text-text-tertiary hover:text-text-secondary"
                }`}
              >
                {t(option.key)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* scan progress */}
      {scanning && scanProgress && scanProgress.currentName && (
        <div className="mx-[22px] mt-[10px] flex items-center gap-[8px] rounded-lg bg-border-alpha-14 px-[12px] py-[8px] text-[12px] text-text-secondary">
          <Refresh2Line size={14} className="animate-spin" />
          <span className="min-w-0 flex-1 truncate">{scanProgress.currentName}</span>
          <span className="tabular-nums text-text-tertiary">
            +{scanProgress.tracksAdded}
          </span>
        </div>
      )}

      {/* track list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] pb-[90px] pt-[12px]">
        {!loading && tracks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-[6px] pb-[40px] text-center">
            <span className="flex h-[64px] w-[64px] items-center justify-center rounded-2xl bg-border-alpha-14 text-text-tertiary">
              <FolderOpenLine size={30} />
            </span>
            <h3 className="m-0 mt-[8px] text-[16px] font-[700] text-text-primary">
              {t("local.empty_title")}
            </h3>
            <p className="m-0 max-w-[340px] text-[13px] leading-[1.45] text-text-tertiary">
              {t("local.empty_body")}
            </p>
            <button
              type="button"
              onClick={onAddFolder}
              className="mt-[10px] inline-flex h-[34px] items-center gap-[8px] rounded-lg border-none bg-btn-primary-bg px-[16px] text-[13px] font-[700] text-btn-primary-text transition-all hover:opacity-90"
            >
              <Folder2Line size={16} />
              {t("local.choose_folder")}
            </button>
          </div>
        ) : visible.length === 0 && tracks.length > 0 ? (
          <div className="flex h-full items-center justify-center text-[13px] text-text-tertiary">
            {t("local.no_results")}
          </div>
        ) : (
          <div className="flex flex-col gap-[2px]">
            {visible.map((entry, index) => {
              const coverUrl = coverUrls[entry.fileId];
              const current = isCurrent(entry.id);
              return (
                <div
                  key={entry.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => playRow(index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") playRow(index);
                  }}
                  className={`group flex w-full cursor-pointer items-center gap-[14px] rounded-lg px-[10px] py-[7px] outline-none transition-colors select-none ${
                    current ? "bg-border-alpha-14" : "hover:bg-border-alpha-14"
                  }`}
                >
                  <div className="relative h-[46px] w-[46px] shrink-0 overflow-hidden rounded-md bg-border-alpha-14">
                    {coverUrl ? (
                      <img
                        src={coverUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-text-tertiary">
                        <Music2Line size={20} />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`m-0 truncate text-[14.5px] font-[600] leading-[1.25] ${
                        current ? "text-[#e08c3f]" : "text-text-primary"
                      }`}
                    >
                      {entry.title}
                    </p>
                    <p className="m-0 truncate text-[12.5px] leading-[1.3] text-text-secondary">
                      {entry.artist}
                      {entry.album ? ` — ${entry.album}` : ""}
                    </p>
                  </div>
                  <span className="hidden shrink-0 text-[12px] tabular-nums text-text-tertiary sm:block">
                    {entry.path ?? entry.fileName}
                  </span>
                  <span className="shrink-0 text-[12px] tabular-nums text-text-tertiary">
                    {formatDuration(entry.durationMs)}
                  </span>
                  <button
                    type="button"
                    aria-label={t("local.remove")}
                    title={`${t("local.remove")} (${formatSize(entry.size)})`}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeTrack(entry.id);
                    }}
                    className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-md border-none bg-transparent text-text-tertiary opacity-0 transition-all hover:bg-black/10 hover:text-[#e05545] group-hover:opacity-100 dark:hover:bg-white/10"
                  >
                    <Delete2Line size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* drag overlay */}
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 z-30 rounded-none border-2 border-dashed border-[#e08c3f]/70 bg-[#e08c3f]/8"
          />
        )}
      </AnimatePresence>

      {/* toast pill */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="fixed bottom-[86px] left-1/2 z-40 -translate-x-1/2 rounded-full bg-[#161618]/95 px-[16px] py-[9px] text-[12.5px] font-[600] text-white shadow-[0_10px_32px_rgba(0,0,0,0.4)]"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
