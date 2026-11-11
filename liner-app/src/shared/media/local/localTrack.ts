import type { Track } from "@/shared/types";
import { toLocalTrackId } from "./localTrackIds";

export interface LocalTrackRecord {
  /** first 20 hex chars of the file's SHA-1 — stable across re-adds */
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  fileName: string;
  mimeType: string;
  byteSize: number;
  addedAt: number;
  cover?: Blob;
}

export interface LocalImportResult {
  added: LocalTrackRecord[];
  duplicates: number;
  failed: string[];
}

export function localRecordToTrack(
  record: LocalTrackRecord,
  coverUrl = "",
): Track {
  return {
    id: toLocalTrackId(record.id),
    title: record.title,
    artists: record.artist,
    coverUrl,
    durationMs: record.durationMs,
    playCount: 0,
    ...(record.album ? { album: { id: record.id, title: record.album } } : {}),
  };
}
