// Liner web port: local music library store.
//
// Recreated from the shipped bundle (untracked source lost — worklog Task 26).
// Zustand store the LocalMusicPage drives; also exposes object URLs for
// embedded cover art on demand (revoked on track removal).

import { create } from "zustand";
import { log } from "@/shared/utils/logger";
import type { Track } from "@/shared/types/track";
import type { LocalFileRecord } from "../lib/localMusicDb";
import { localMusicDb } from "../lib/localMusicDb";
import { isAudioFileName } from "../lib/audioTags";
import {
  addAudioFile,
  filesFromDataTransfer,
  hasFileSystemAccess,
  pickMusicFolder,
  scanDirectoryHandle,
} from "../lib/scan";

export interface LocalTrackEntry {
  id: string;
  fileId: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  fileName: string;
  path?: string;
  folderId?: string;
  size: number;
  addedAt: number;
}

export interface LocalFolderEntry {
  id: string;
  name: string;
  addedAt: number;
  hasHandle: boolean;
}

export type LocalSortId = "title" | "artist" | "album" | "recent";

interface LocalMusicState {
  tracks: LocalTrackEntry[];
  folders: LocalFolderEntry[];
  loading: boolean;
  scanning: boolean;
  scanProgress: { filesSeen: number; tracksAdded: number; currentName: string } | null;
  error: string | null;
  coverUrls: Record<string, string>;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  addFolder: () => Promise<boolean>;
  addDroppedFiles: (transfer: DataTransfer) => Promise<number>;
  addPickedFiles: () => Promise<number>;
  addFilesList: (files: File[]) => Promise<number>;
  rescanAll: () => Promise<number>;
  removeFolder: (id: string) => Promise<void>;
  removeTrack: (id: string) => Promise<void>;
  getCoverUrl: (fileId: string) => Promise<string | null>;
}

function trackFromRecord(record: LocalFileRecord): LocalTrackEntry {
  const meta = record.meta;
  const baseName = record.name.replace(/\.[a-z0-9]+$/i, "");
  return {
    id: record.id,
    fileId: record.id,
    title: meta?.title || baseName || record.name,
    artist: meta?.artist || "Unknown artist",
    album: meta?.album,
    durationMs: meta?.durationMs ?? 0,
    fileName: record.name,
    path: record.path,
    folderId: record.folderId,
    size: record.size,
    addedAt: record.addedAt,
  };
}

export function toPlayerTrack(entry: LocalTrackEntry): Track {
  return {
    id: entry.id,
    title: entry.title,
    artists: entry.artist,
    coverUrl: "",
    durationMs: entry.durationMs,
    playCount: 0,
    localFileId: entry.fileId,
    localPath: entry.path,
    ...(entry.album
      ? { album: { id: `local-album:${entry.album}`, title: entry.album } }
      : {}),
  };
}

/** audio files only — directory pickers (webkitdirectory) list everything */
export function filterAudioFiles(files: File[]): File[] {
  return files.filter(
    (file) => isAudioFileName(file.name) || file.type.startsWith("audio/"),
  );
}

export function sortTracks(
  tracks: LocalTrackEntry[],
  sort: LocalSortId,
): LocalTrackEntry[] {
  const list = [...tracks];
  switch (sort) {
    case "title":
      list.sort((left, right) => left.title.localeCompare(right.title));
      break;
    case "artist":
      list.sort(
        (left, right) =>
          left.artist.localeCompare(right.artist) ||
          left.title.localeCompare(right.title),
      );
      break;
    case "album":
      list.sort(
        (left, right) =>
          (left.album ?? "\uffff").localeCompare(right.album ?? "\uffff") ||
          left.title.localeCompare(right.title),
      );
      break;
    case "recent":
      list.sort((left, right) => right.addedAt - left.addedAt);
      break;
  }
  return list;
}

export const useLocalMusicStore = create<LocalMusicState>()((set, get) => ({
  tracks: [],
  folders: [],
  loading: true,
  scanning: false,
  scanProgress: null,
  error: null,
  coverUrls: {},

  init: async () => {
    if (get().tracks.length > 0 || get().folders.length > 0) return;
    await get().refresh();
  },

  refresh: async () => {
    set({ loading: true });
    try {
      const [files, folders] = await Promise.all([
        localMusicDb.getAllFiles(),
        localMusicDb.getAllFolders(),
      ]);
      set({
        tracks: files
          .map(trackFromRecord)
          .sort((left, right) => right.addedAt - left.addedAt),
        folders: folders
          .map((folder) => ({
            id: folder.id,
            name: folder.name,
            addedAt: folder.addedAt,
            hasHandle: !!folder.handle,
          }))
          .sort((left, right) => left.addedAt - right.addedAt),
        loading: false,
        error: null,
      });
    } catch (error) {
      log("yellow", "local-music", `library load failed: ${String(error)}`);
      set({ loading: false });
    }
  },

  addFolder: async () => {
    if (!hasFileSystemAccess()) {
      await get().addPickedFiles();
      return false;
    }
    const picked = await pickMusicFolder();
    if (!picked) return false;
    const id = `folder:${picked.name}:${picked.handle.name.length}:${Date.now().toString(36)}`;
    set({ scanning: true, scanProgress: null, error: null });
    try {
      await localMusicDb.putFolder({
        id,
        name: picked.name,
        addedAt: Date.now(),
        handle: picked.handle,
      });
      await scanDirectoryHandle(picked.handle, id, (progress) =>
        set({ scanProgress: progress }),
      );
      await get().refresh();
      return true;
    } catch (error) {
      set({ error: String(error) });
      return false;
    } finally {
      set({ scanning: false, scanProgress: null });
    }
  },

  addDroppedFiles: async (transfer: DataTransfer) => {
    set({ scanning: true, error: null });
    try {
      const files = await filesFromDataTransfer(transfer);
      let added = 0;
      for (const file of files) {
        if (await addAudioFile(file)) added += 1;
      }
      await get().refresh();
      return added;
    } catch (error) {
      set({ error: String(error) });
      return 0;
    } finally {
      set({ scanning: false, scanProgress: null });
    }
  },

  addPickedFiles: () =>
    typeof document === "undefined"
      ? Promise.resolve(0)
      : new Promise<number>((resolve) => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "audio/*,.mp3,.flac,.wav,.m4a,.aac,.ogg,.opus,.wma,.aiff";
          input.multiple = true;
          input.onchange = async () => {
            const files = Array.from(input.files ?? []);
            set({ scanning: true, error: null });
            try {
              let added = 0;
              for (const file of files) {
                if (await addAudioFile(file)) added += 1;
              }
              await get().refresh();
              resolve(added);
            } catch (error) {
              set({ error: String(error) });
              resolve(0);
            } finally {
              set({ scanning: false });
            }
          };
          input.oncancel = () => resolve(0);
          input.click();
        }),

  addFilesList: async (rawFiles: File[]) => {
    const files = filterAudioFiles(rawFiles);
    if (files.length === 0) return 0;
    set({ scanning: true, error: null });
    try {
      let added = 0;
      for (const file of files) {
        if (await addAudioFile(file)) added += 1;
      }
      await get().refresh();
      return added;
    } catch (error) {
      set({ error: String(error) });
      return 0;
    } finally {
      set({ scanning: false });
    }
  },

  rescanAll: async () => {
    const rescanable = get().folders.filter((folder) => folder.hasHandle);
    if (rescanable.length === 0) {
      await get().refresh();
      return 0;
    }
    set({ scanning: true, scanProgress: null, error: null });
    let total = 0;
    try {
      const records = await localMusicDb.getAllFolders();
      for (const folder of rescanable) {
        const handle = records.find((record) => record.id === folder.id)?.handle;
        if (!handle) continue;
        const permission =
          (await handle.queryPermission?.({ mode: "read" }).catch(() => "denied")) ??
          "denied";
        if (
          permission !== "granted" &&
          (await handle.requestPermission?.({ mode: "read" }).catch(() => "denied")) !==
            "granted"
        )
          continue;
        const result = await scanDirectoryHandle(handle, folder.id, (progress) =>
          set({ scanProgress: progress }),
        );
        total += result.added;
      }
      await get().refresh();
      return total;
    } catch (error) {
      set({ error: String(error) });
      return total;
    } finally {
      set({ scanning: false, scanProgress: null });
    }
  },

  removeFolder: async (id: string) => {
    await localMusicDb.deleteFolder(id);
    const tracks = get().tracks.filter((track) => track.folderId === id);
    for (const track of tracks) await localMusicDb.deleteFile(track.fileId);
    await get().refresh();
  },

  removeTrack: async (id: string) => {
    await localMusicDb.deleteFile(id);
    const { coverUrls } = get();
    const url = coverUrls[id];
    if (url) URL.revokeObjectURL(url);
    set((state) => ({
      tracks: state.tracks.filter((track) => track.id !== id),
      coverUrls: Object.fromEntries(
        Object.entries(state.coverUrls).filter(([key]) => key !== id),
      ),
    }));
  },

  getCoverUrl: async (fileId: string) => {
    const cached = get().coverUrls[fileId];
    if (cached) return cached;
    const cover = await localMusicDb.getCover(fileId);
    if (!cover) return null;
    const url = URL.createObjectURL(cover.blob);
    set((state) => ({ coverUrls: { ...state.coverUrls, [fileId]: url } }));
    return url;
  },
}));
