import { parseBlob } from "music-metadata";
import type { LocalTrackRecord } from "./localTrack";

export const LOCAL_AUDIO_EXTENSIONS = [
  "mp3",
  "flac",
  "m4a",
  "aac",
  "ogg",
  "opus",
  "wav",
  "webm",
] as const;

const MIME_BY_EXTENSION: Record<string, string> = {
  mp3: "audio/mpeg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  webm: "audio/webm",
};

const SUPPORTED = new Set<string>(LOCAL_AUDIO_EXTENSIONS);

const AUDIO_EXTENSION = new RegExp(`\\.(${LOCAL_AUDIO_EXTENSIONS.join("|")})$`, "i");

export function isAudioFile(file: File): boolean {
  return AUDIO_EXTENSION.test(file.name);
}

export function audioExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function mimeTypeFor(name: string): string {
  return MIME_BY_EXTENSION[audioExtension(name)] ?? "application/octet-stream";
}

/** "01 - Artist - Title.mp3" → artist "Artist", title "Title" */
export function namesFromFileName(fileName: string): {
  title: string;
  artist: string;
} {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  const cleaned = base.replace(/^\d{1,3}[\s.\-_]+/, "").trim() || base;
  const separator = cleaned.indexOf(" - ");
  if (separator > 0) {
    return {
      artist: cleaned.slice(0, separator).trim(),
      title: cleaned.slice(separator + 3).trim(),
    };
  }
  return { title: cleaned, artist: "" };
}

/** first 20 hex chars of the file's SHA-1, exactly like the desktop importer */
export async function hashAudioFile(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", buffer);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex.slice(0, 20);
}

const DURATION_FALLBACK_TIMEOUT_MS = 10_000;

function durationFromElement(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    const done = (ms: number) => {
      URL.revokeObjectURL(url);
      audio.removeAttribute("src");
      resolve(ms);
    };
    const timeout = setTimeout(() => done(0), DURATION_FALLBACK_TIMEOUT_MS);
    audio.addEventListener("loadedmetadata", () => {
      clearTimeout(timeout);
      const seconds = Number.isFinite(audio.duration) ? audio.duration : 0;
      done(Math.round(seconds * 1000));
    });
    audio.addEventListener("error", () => {
      clearTimeout(timeout);
      done(0);
    });
    audio.preload = "metadata";
    audio.src = url;
  });
}

interface ParsedTags {
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  cover?: Blob;
}

export async function readAudioTags(file: File): Promise<ParsedTags> {
  const fallback = namesFromFileName(file.name);
  const mimeType = mimeTypeFor(file.name);
  try {
    const { common, format } = await parseBlob(file, { duration: true });
    const picture = common.picture?.[0];
    const cover = picture
      ? new Blob([picture.data as BlobPart], {
          type: picture.format || "image/jpeg",
        })
      : undefined;
    let durationMs = Math.round((format.duration ?? 0) * 1000);
    if (!durationMs) durationMs = await durationFromElement(file);
    return {
      title: common.title?.trim() || fallback.title,
      artist:
        common.artists?.join(", ").trim() ||
        common.artist?.trim() ||
        fallback.artist,
      ...(common.album?.trim() ? { album: common.album.trim() } : {}),
      durationMs,
      ...(cover ? { cover } : {}),
    };
  } catch {
    // unparseable container: still import with the filename-derived tags
    const durationMs = await durationFromElement(file);
    return { ...fallback, durationMs };
  }
}

/**
 * Web port of the desktop importer: hash → dedupe → tag → record. Returns
 * null when the file is a duplicate of an already-imported id.
 */
export async function importAudioFile(
  file: File,
  knownIds: Set<string>,
): Promise<LocalTrackRecord | null> {
  const extension = audioExtension(file.name);
  if (!SUPPORTED.has(extension)) throw new Error("unsupported");
  const mimeType = mimeTypeFor(file.name);
  const buffer = await file.arrayBuffer();
  const id = await hashAudioFile(buffer);
  if (knownIds.has(id)) return null;
  const tags = await readAudioTags(file);
  return {
    id,
    title: tags.title,
    artist: tags.artist,
    ...(tags.album ? { album: tags.album } : {}),
    durationMs: tags.durationMs,
    fileName: file.name,
    mimeType,
    ...(tags.cover ? { cover: tags.cover } : {}),
    byteSize: file.size,
    addedAt: Date.now(),
  };
}
