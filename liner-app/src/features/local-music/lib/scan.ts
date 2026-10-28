// Liner web port: local music folder scanning.
//
// Recreated from the shipped bundle (untracked source lost — worklog Task 26).
// File System Access API directory picker with recursive walk (depth ≤ 6,
// ≤ 5000 entries), plus drag&drop via webkitGetAsEntry recursion and a plain
// <input type=file multiple> fallback for browsers without FSA.

import {
  isAudioFileName,
  makeLocalFileId,
  mergeTags,
  probeAudioDuration,
  readAudioTags,
} from "./audioTags";
import { localMusicDb } from "./localMusicDb";

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: "read" | "readwrite";
    }) => Promise<FileSystemDirectoryHandle>;
  }

  interface FileSystemDirectoryHandle {
    queryPermission?: (descriptor: {
      mode?: "read" | "readwrite";
    }) => Promise<PermissionState>;
    requestPermission?: (descriptor: {
      mode?: "read" | "readwrite";
    }) => Promise<PermissionState>;
  }
}

export interface PickedFolder {
  handle: FileSystemDirectoryHandle;
  name: string;
}

export interface ScanProgress {
  filesSeen: number;
  tracksAdded: number;
  currentName: string;
}

export function hasFileSystemAccess(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickMusicFolder(): Promise<PickedFolder | null> {
  if (!hasFileSystemAccess()) return null;
  try {
    const picker = window.showDirectoryPicker;
    if (!picker) return null;
    const handle = await picker({ mode: "read" });
    return { handle, name: handle.name };
  } catch {
    // user cancelled the picker
    return null;
  }
}

type FileVisitor = (file: File) => void;

async function walkDirectory(
  dir: FileSystemDirectoryHandle,
  onFile: FileVisitor,
  prefix: string,
  depth = 0,
  seen = 0,
): Promise<number> {
  if (depth > 6 || seen > 5000) return seen;
  const entries = dir as unknown as AsyncIterable<[string, FileSystemHandle]>;
  for await (const [name, handle] of entries) {
    seen += 1;
    if (handle.kind === "file") {
      if (isAudioFileName(name)) {
        try {
          onFile(await (handle as FileSystemFileHandle).getFile());
        } catch {
          // unreadable file — skip
        }
      }
    } else if (handle.kind === "directory" && !name.startsWith(".")) {
      seen = await walkDirectory(
        handle as FileSystemDirectoryHandle,
        onFile,
        `${prefix}${name}/`,
        depth + 1,
        seen,
      );
    }
  }
  return seen;
}

async function filesFromDataTransfer(
  transfer: DataTransfer,
): Promise<File[]> {
  const files: File[] = [];
  const entries = Array.from(transfer.items ?? [])
    .map((item) =>
      typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null,
    )
    .filter(Boolean) as FileSystemEntry[];
  if (entries.length > 0) {
    const readEntry = async (entry: FileSystemEntry, depth: number) => {
      if (depth > 6 || files.length > 2000) return;
      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry;
        await new Promise<void>((resolve) => {
          fileEntry.file(
            (file) => {
              if (isAudioFileName(file.name)) files.push(file);
              resolve();
            },
            () => resolve(),
          );
        });
      } else if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry;
        const reader = dirEntry.createReader();
        const readBatch = () =>
          new Promise<FileSystemEntry[]>((resolve) => {
            reader.readEntries(
              (batch) => resolve(batch),
              () => resolve([]),
            );
          });
        let batch = await readBatch();
        while (batch.length > 0) {
          for (const child of batch) await readEntry(child, depth + 1);
          batch = await readBatch();
        }
      }
    };
    for (const entry of entries) await readEntry(entry, 0);
    return files;
  }
  for (const file of Array.from(transfer.files ?? []))
    if (isAudioFileName(file.name)) files.push(file);
  return files;
}

/** id for a file record; duplicates (same name+size+mtime) are skipped */
async function addAudioFile(
  file: File,
  options: { folderId?: string; path?: string } = {},
): Promise<string | null> {
  const id = makeLocalFileId(file.name, file.size, file.lastModified);
  if (await localMusicDb.getFile(id)) return null;
  const tags = await readAudioTags(file);
  const headerDuration = tags.durationMs && tags.durationMs > 0 ? tags.durationMs : 0;
  const meta = mergeTags(tags, file.name, headerDuration);
  const record = {
    id,
    name: file.name,
    blob: file,
    size: file.size,
    type: file.type || guessMime(file.name),
    lastModified: file.lastModified,
    addedAt: Date.now(),
    folderId: options.folderId,
    path: options.path,
    meta,
  };
  await localMusicDb.putFile(record);
  if (tags.coverBlob) localMusicDb.putCover(id, tags.coverBlob);
  // duration unknown from tags → probe via <audio> metadata in the background
  if (meta.durationMs === 0) {
    probeAudioDuration(file).then((ms) => {
      if (ms > 0)
        localMusicDb.getFile(id).then((existing) => {
          if (existing && existing.meta && !existing.meta.durationMs)
            localMusicDb.putFile({
              ...existing,
              meta: { ...existing.meta, durationMs: ms },
            });
        });
    });
  }
  return id;
}

function guessMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
  if (lower.endsWith(".ogg") || lower.endsWith(".oga") || lower.endsWith(".opus"))
    return "audio/ogg";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".aiff") || lower.endsWith(".aif")) return "audio/aiff";
  if (lower.endsWith(".wma")) return "audio/x-ms-wma";
  return "audio/mpeg";
}

export async function scanDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  folderId: string,
  onProgress?: (progress: ScanProgress) => void,
): Promise<{ added: number; skipped: number }> {
  const files: File[] = [];
  let seen = 0;
  await walkDirectory(
    handle,
    (file) => {
      seen += 1;
      files.push(file);
      onProgress?.({ filesSeen: seen, tracksAdded: 0, currentName: file.name });
    },
    "",
  );
  let added = 0;
  let skipped = 0;
  for (const file of files) {
    onProgress?.({ filesSeen: seen, tracksAdded: added, currentName: file.name });
    const id = await addAudioFile(file, { folderId, path: handle.name });
    if (id) added += 1;
    else skipped += 1;
  }
  onProgress?.({ filesSeen: seen, tracksAdded: added, currentName: "" });
  return { added, skipped };
}

export { addAudioFile, filesFromDataTransfer };
