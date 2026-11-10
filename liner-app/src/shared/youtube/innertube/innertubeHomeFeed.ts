import type { Track } from "@/shared/contracts";
import { asArray, asRecord, type JsonRecord } from "@/shared/utils/json";
import { InnertubeError, postInnertube } from "./innertubeClient";
import { getPlaylist } from "./innertubeCollections";
import { getPageType, getRuns, getText, runsToArtists } from "./innertubeJson";
import { coverFromThumbnail } from "./innertubeThumbnail";
import { mapInnertubeTrack } from "./innertubeTrackMapper";

// YouTube Music's own home screen, fetched the same way the desktop client
// (Riff) does it: an anonymous innertube `browse` on FEmusic_home through the
// SPA's same-origin proxy. The site backend only knows about this site's own
// accounts, so for a fresh visitor its explore endpoints are all empty — the
// home feed falls back to these shelves instead ("Quick picks", "New
// releases", playlist carousels, ...). Same-origin proxy = zero CORS.

export const HOME_FEED_BROWSE_ID = "FEmusic_home";

export interface HomeFeedCollection {
  kind: "album" | "playlist" | "single" | "video";
  id: string;
  title: string;
  subtitle: string | null;
  coverUrl: string | null;
  artists: { id: string; name: string }[];
}

export interface HomeFeedShelf {
  title: string | null;
  tracks: Track[];
  collections: HomeFeedCollection[];
}

export interface HomeFeedItems {
  shelves: HomeFeedShelf[];
  /** Every track on the feed in shelf order (Quick picks first). */
  quickPicks: Track[];
  albums: HomeFeedCollection[];
  playlists: HomeFeedCollection[];
}

function shelfRenderer(shelf: JsonRecord): JsonRecord | undefined {
  return (
    asRecord(shelf.musicCarouselShelfRenderer) ??
    asRecord(shelf.musicShelfRenderer)
  );
}

function shelfTitle(renderer: JsonRecord | undefined): string | null {
  const header = asRecord(renderer?.header);
  const basic = asRecord(header?.musicCarouselShelfBasicHeaderRenderer);
  const responsive = asRecord(header?.musicResponsiveHeaderRenderer);
  return (
    getText(basic?.title) ??
    getText(responsive?.title) ??
    getText(header?.title) ??
    null
  );
}

function watchVideoId(endpoint: unknown): string | undefined {
  const videoId = asRecord(asRecord(endpoint)?.watchEndpoint)?.videoId;
  return typeof videoId === "string" ? videoId : undefined;
}

const TWO_ROW_KINDS: Record<string, HomeFeedCollection["kind"]> = {
  MUSIC_PAGE_TYPE_ALBUM: "album",
  MUSIC_PAGE_TYPE_PLAYLIST: "playlist",
  MUSIC_PAGE_TYPE_SINGLE: "single",
};

export function mapTwoRowItem(raw: unknown): HomeFeedCollection | null {
  const renderer = asRecord(asRecord(raw)?.musicTwoRowItemRenderer);
  if (!renderer) return null;

  const title = getText(renderer.title);
  if (!title) return null;

  const subtitleRuns = getRuns(renderer.subtitle);
  const subtitleText = subtitleRuns
    .map((run) => (typeof run.text === "string" ? run.text : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

  const navigation = asRecord(renderer.navigationEndpoint);
  const tap = asRecord(renderer.onTap);
  const titleRunEndpoint = asRecord(getRuns(renderer.title)[0]?.navigationEndpoint);
  const browse =
    asRecord(navigation?.browseEndpoint) ??
    asRecord(tap?.browseEndpoint) ??
    asRecord(titleRunEndpoint?.browseEndpoint);
  const browseId =
    typeof browse?.browseId === "string" ? browse.browseId : undefined;
  const pageType = getPageType(browse);

  const cover = coverFromThumbnail(renderer.thumbnailRenderer);
  const coverUrl = cover?.url ?? null;
  const artists = runsToArtists(subtitleRuns);

  const watchId = watchVideoId(navigation) ?? watchVideoId(tap);
  const kind =
    pageType !== undefined && TWO_ROW_KINDS[pageType] !== undefined
      ? TWO_ROW_KINDS[pageType]
      : browseId
        ? null
        : watchId
          ? "video"
          : null;

  if (browseId && kind) {
    return { kind, id: browseId, title, subtitle: subtitleText || null, coverUrl, artists };
  }
  if (watchId) {
    return { kind: "video", id: watchId, title, subtitle: subtitleText || null, coverUrl, artists };
  }
  return null;
}

export function mapHomeShelf(raw: unknown): HomeFeedShelf | null {
  const shelf = asRecord(raw);
  const renderer = shelfRenderer(shelf ?? {});
  if (!renderer) return null;

  const title = shelfTitle(renderer);
  const tracks: Track[] = [];
  const collections: HomeFeedCollection[] = [];
  const seenTracks = new Set<string>();
  const seenCollections = new Set<string>();

  for (const item of asArray(renderer.contents)) {
    if (asRecord(item)?.musicTwoRowItemRenderer) {
      const collection = mapTwoRowItem(item);
      if (collection && !seenCollections.has(collection.id)) {
        seenCollections.add(collection.id);
        collections.push(collection);
      }
      continue;
    }
    const track = mapInnertubeTrack(item);
    if (track && !seenTracks.has(track.id)) {
      seenTracks.add(track.id);
      tracks.push(track);
    }
  }

  if (tracks.length === 0 && collections.length === 0) return null;
  return { title, tracks, collections };
}

function sectionList(body: unknown): JsonRecord | undefined {
  const single = asRecord(
    asRecord(asRecord(body)?.contents)?.singleColumnBrowseResultsRenderer,
  );
  const tab = asRecord(asArray(single?.tabs)[0]);
  const content = asRecord(asRecord(tab?.tabRenderer)?.content);
  return asRecord(content?.sectionListRenderer);
}

// Fresh browse responses nest shelves under contents.singleColumnBrowse…
// continuation responses under continuationContents.sectionList… instead.
function sectionContinuationRenderer(body: unknown): JsonRecord | undefined {
  return asRecord(
    asRecord(asRecord(body)?.continuationContents)
      ?.sectionListContinuationRenderer,
  );
}

function parseShelves(body: unknown): HomeFeedShelf[] {
  const content = sectionContinuationRenderer(body) ?? sectionList(body);
  return asArray(asRecord(content)?.contents)
    .map((shelf) => mapHomeShelf(shelf))
    .filter((shelf): shelf is HomeFeedShelf => shelf !== null);
}

function sectionContinuation(body: unknown): string | undefined {
  const content = sectionContinuationRenderer(body) ?? sectionList(body);
  const continuations = asArray(asRecord(content)?.continuations);
  const next = asRecord(asRecord(continuations[0])?.nextContinuationData);
  return typeof next?.continuation === "string" ? next.continuation : undefined;
}

/**
 * Fetches YouTube Music's home feed shelves (FEmusic_home, one continuation
 * pass for more variety). Throws InnertubeError when YouTube is unreachable.
 */
const CHARTS_BROWSE_ID = "FEmusic_charts";

// The anonymous home feed rotates per visitor session and occasionally ships
// without any track shelf ("Quick picks"). Charts are deterministic — pull the
// top chart playlist and use its real track list as the track shelf instead.
async function ensureTrackShelf(
  shelves: HomeFeedShelf[],
  signal?: AbortSignal,
): Promise<HomeFeedShelf[]> {
  if (shelves.some((shelf) => shelf.tracks.length > 0)) return shelves;
  const charts = await postInnertube(
    "browse",
    { browseId: CHARTS_BROWSE_ID },
    { signal },
  ).catch(() => null);
  if (!charts) return shelves;
  const card = parseShelves(charts)
    .flatMap((shelf) => shelf.collections)
    .find(
      (collection) =>
        collection.kind === "playlist" && collection.id.startsWith("VL"),
    );
  if (!card) return shelves;
  const details = await getPlaylist(card.id, signal).catch(() => null);
  if (!details || details.tracks.length === 0) return shelves;
  shelves.push({ title: card.title, tracks: details.tracks, collections: [] });
  return shelves;
}

export async function fetchInnertubeHomeFeed(
  signal?: AbortSignal,
): Promise<HomeFeedShelf[]> {
  let body: unknown;
  try {
    body = await postInnertube(
      "browse",
      { browseId: HOME_FEED_BROWSE_ID },
      { signal },
    );
  } catch (error) {
    if (error instanceof InnertubeError) throw error;
    throw new InnertubeError("YouTube Music home feed is unreachable.", 0);
  }
  const shelves = parseShelves(body);
  const continuation = sectionContinuation(body);
  if (continuation) {
    const more = await postInnertube(
      "browse",
      { browseId: HOME_FEED_BROWSE_ID, continuation },
      { signal },
    )
      .then((nextBody) => parseShelves(nextBody))
      .catch(() => []);
    shelves.push(...more);
  }
  return ensureTrackShelf(shelves, signal);
}

export function collectHomeFeedItems(shelves: HomeFeedShelf[]): HomeFeedItems {
  const quickPicks: Track[] = [];
  const albums: HomeFeedCollection[] = [];
  const playlists: HomeFeedCollection[] = [];
  const seenTracks = new Set<string>();
  const seenCollections = new Set<string>();

  for (const shelf of shelves) {
    for (const track of shelf.tracks) {
      if (!seenTracks.has(track.id)) {
        seenTracks.add(track.id);
        quickPicks.push(track);
      }
    }
    for (const collection of shelf.collections) {
      if (seenCollections.has(collection.id)) continue;
      seenCollections.add(collection.id);
      if (collection.kind === "album") albums.push(collection);
      if (collection.kind === "playlist") playlists.push(collection);
    }
  }

  return { shelves, quickPicks, albums, playlists };
}
