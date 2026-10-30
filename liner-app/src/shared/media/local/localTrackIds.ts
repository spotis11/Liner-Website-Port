// Shared helper for identifying local (user-imported) audio tracks.
// Mirrors upstream tryliner/desktop src/shared/media/local/localTrackIds.ts;
// the web port only needs the id-shape helpers (imports resolve through
// IndexedDB blob URLs, not the liner-local:// protocol).
const LOCAL_TRACK_PREFIX = "local:";

export function isLocalTrackId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(LOCAL_TRACK_PREFIX);
}

export function toLocalTrackId(fileId: string): string {
  return `${LOCAL_TRACK_PREFIX}${fileId}`;
}

export function localFileId(trackId: string): string {
  return trackId.slice(LOCAL_TRACK_PREFIX.length);
}
