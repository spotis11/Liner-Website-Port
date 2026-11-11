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
