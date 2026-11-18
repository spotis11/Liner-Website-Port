import type { ImportedTrack, ImportSource } from "@classic/shared/contracts";

export interface ClientImportedTrack extends ImportedTrack {
  artistIds?: (string | undefined)[];
  albumId?: string;
}

export interface ClientImportedPlaylist {
  source: ImportSource;
  sourceUrl: string;
  title: string;
  description?: string;
  tracks: ClientImportedTrack[];
  canonicalTrackIds?: string[];
}
