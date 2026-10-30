import type {
  TrackArtist as ContractTrackArtist,
  TrackAudioVariant,
} from "../contracts";

export interface TrackArtist {
  id?: string;
  name: string;
}

export interface Track {
  id: string;
  playlistItemId?: string;
  title: string;
  artists: string;
  artistId?: string;
  artistList?: (ContractTrackArtist | TrackArtist)[];
  coverUrl: string;
  durationMs: number;
  playCount: number;
  explicit?: boolean;
  audioVariant?: TrackAudioVariant;
  releaseDate?: string;
  album?: {
    id: string;
    title: string;
  };
  /**
   * Local library track: id of the audio blob in the local-music IndexedDB.
   * Streams for these tracks are served from the user's own files
   * (see local-music/lib/localMusicDb → resolvePlaybackStream branch).
   */
  localFileId?: string;
  /** original absolute path / relative folder path, local tracks only */
  localPath?: string;
}
