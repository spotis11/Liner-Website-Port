import { create } from "zustand";
import { linerDb } from "@/shared/storage";

export type DownloadStatus =
  | "queued"
  | "downloading"
  | "downloaded"
  | "error";

export interface DownloadState {
  status: DownloadStatus;
  received?: number;
  total?: number;
  error?: string;
  title?: string;
  artists?: string;
}

interface DownloadsState {
  statuses: Record<string, DownloadState>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setStatus: (trackId: string, state: DownloadState) => void;
  patchProgress: (trackId: string, received: number, total?: number) => void;
  clear: (trackId: string) => void;
}

export function metaFromTrack(track: {
  title: string;
  artists: string;
}): Pick<DownloadState, "title" | "artists"> {
  return { title: track.title, artists: track.artists };
}

export const useDownloadsStore = create<DownloadsState>()((set, get) => ({
  statuses: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const pinned = await linerDb.getPinnedAudioRecords();
    const statuses: Record<string, DownloadState> = {};
    for (const record of pinned) {
      statuses[record.trackId] = { status: "downloaded" };
    }
    set({ statuses, hydrated: true });
  },

  setStatus: (trackId, state) =>
    set((prev) => ({
      statuses: { ...prev.statuses, [trackId]: state },
    })),

  patchProgress: (trackId, received, total) =>
    set((prev) => {
      const current = prev.statuses[trackId];
      if (!current || current.status !== "downloading") return prev;
      return {
        statuses: {
          ...prev.statuses,
          [trackId]: { ...current, received, total },
        },
      };
    }),

  clear: (trackId) =>
    set((prev) => {
      const next = { ...prev.statuses };
      delete next[trackId];
      return { statuses: next };
    }),
}));

export function isDownloaded(
  statuses: Record<string, DownloadState>,
  trackId?: string,
): boolean {
  if (!trackId) return false;
  return statuses[trackId]?.status === "downloaded";
}
