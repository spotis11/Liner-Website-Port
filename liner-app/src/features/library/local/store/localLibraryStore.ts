import { create } from "zustand";
import {
  importAudioFile,
  isAudioFile,
  isLocalTrackId,
  localFileId,
  localRecordToTrack,
  type LocalImportResult,
  type LocalTrackRecord,
} from "@/shared/media/local";
import { linerDb } from "@/shared/storage";
import { playerEngine } from "@/features/player";
import type { Track } from "@/shared/types";

type LoadState = "idle" | "loading" | "ready";

const LOCAL_FILE_ACCEPT =
  ".mp3,.flac,.m4a,.aac,.ogg,.opus,.wav,.webm,audio/*";

// object URLs for cover artwork blobs; revoked when the file is removed
const coverUrls = new Map<string, string>();

function coverUrlFor(record: LocalTrackRecord): string {
  if (!record.cover) return "";
  let url = coverUrls.get(record.id);
  if (!url) {
    url = URL.createObjectURL(record.cover);
    coverUrls.set(record.id, url);
  }
  return url;
}

function revokeCoverUrls(fileIds: Iterable<string>): void {
  for (const id of fileIds) {
    const url = coverUrls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      coverUrls.delete(id);
    }
  }
}

async function releasePlayingTrack(fileIds: string[] | "all"): Promise<void> {
  const current = playerEngine.getSnapshot().currentTrack?.id;
  if (!current || !isLocalTrackId(current)) return;
  const removed =
    fileIds === "all" || fileIds.includes(localFileId(current));
  if (removed) await playerEngine.stopAndClear().catch(() => {});
}

interface LocalLibraryState {
  records: LocalTrackRecord[];
  tracks: Track[];
  loadState: LoadState;
  importing: boolean;
  load: () => Promise<void>;
  importFiles: (files: File[]) => Promise<LocalImportResult | null>;
  pickFiles: () => Promise<LocalImportResult | null>;
  remove: (fileIds: string[]) => Promise<void>;
  removeAll: () => Promise<number>;
}

const newestFirst = (records: LocalTrackRecord[]) =>
  [...records].sort((a, b) => b.addedAt - a.addedAt);

const withTracks = (records: LocalTrackRecord[]) => {
  const sorted = newestFirst(records);
  return {
    records: sorted,
    tracks: sorted.map((record) =>
      localRecordToTrack(record, coverUrlFor(record)),
    ),
  };
};

function pickAudioFiles(): Promise<File[] | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = LOCAL_FILE_ACCEPT;
    input.style.display = "none";
    document.body.appendChild(input);
    let settled = false;
    const finish = (files: File[] | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => {
      finish(input.files ? Array.from(input.files) : null);
    });
    input.addEventListener("cancel", () => finish(null));
    input.click();
  });
}

export const useLocalLibraryStore = create<LocalLibraryState>((set, get) => {
  const runImport = async (
    request: () => Promise<LocalImportResult | null>,
  ): Promise<LocalImportResult | null> => {
    set({ importing: true });
    try {
      const result = await request();
      if (result && result.added.length > 0) {
        set(withTracks([...get().records, ...result.added]));
      }
      return result;
    } finally {
      set({ importing: false });
    }
  };

  const importFiles = async (
    files: File[],
  ): Promise<LocalImportResult | null> => {
    const audio = files.filter(isAudioFile);
    if (audio.length === 0) return null;
    return runImport(async () => {
      const known = new Set(get().records.map((record) => record.id));
      const added: LocalTrackRecord[] = [];
      const failed: string[] = [];
      let duplicates = 0;
      // sequential: hashing + tag parsing of several big files at once
      // would spike memory for no real speedup
      for (const file of audio) {
        try {
          const record = await importAudioFile(file, known);
          if (!record) {
            duplicates += 1;
            continue;
          }
          known.add(record.id);
          await linerDb.putLocalTrack(record, file);
          added.push(record);
        } catch {
          failed.push(file.name);
        }
      }
      return { added, duplicates, failed };
    });
  };

  return {
    records: [],
    tracks: [],
    loadState: "idle",
    importing: false,

    load: async () => {
      if (get().loadState === "loading") return;
      set({ loadState: "loading" });
      try {
        const records = await linerDb.listLocalTracks();
        // rows can exist without audio when an import was interrupted
        const complete: LocalTrackRecord[] = [];
        const orphans: string[] = [];
        for (const record of records) {
          (await linerDb.getLocalAudio(record.id))
            ? complete.push(record)
            : orphans.push(record.id);
        }
        if (orphans.length > 0) {
          await Promise.all(
            orphans.map((id) => linerDb.deleteLocalTrack(id).catch(() => {})),
          );
        }
        set({ ...withTracks(complete), loadState: "ready" });
      } catch {
        set({ loadState: "ready" });
      }
    },

    importFiles,

    pickFiles: () =>
      runImport(async () => {
        const files = await pickAudioFiles();
        if (!files || files.length === 0) return null;
        return importFiles(files);
      }),

    remove: async (fileIds) => {
      if (fileIds.length === 0) return;
      const removing = new Set(fileIds);
      set(
        withTracks(
          get().records.filter((record) => !removing.has(record.id)),
        ),
      );
      revokeCoverUrls(fileIds);
      await releasePlayingTrack(fileIds);
      await Promise.all(
        fileIds.map((id) => linerDb.deleteLocalTrack(id).catch(() => {})),
      );
    },

    removeAll: async () => {
      const records = get().records;
      set(withTracks([]));
      revokeCoverUrls(records.map((record) => record.id));
      await releasePlayingTrack("all");
      await linerDb.deleteAllLocalTracks();
      return records.length;
    },
  };
});
