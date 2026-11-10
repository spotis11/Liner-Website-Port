/** Mirrors the SPA's LyricsCandidate contract (shared/contracts/lyrics.ts). */
export interface LyricsCandidate {
  matchedTrack?: {
    title?: string;
    artists?: string[];
    durationMs?: number;
  };
  lyrics: { format: string; content: string };
  provider: string;
  contentKind: string;
  syncLevel: string;
  topPriority?: boolean;
  quality: {
    total: number;
    match: number;
    content: number;
    sync: number;
    source: number;
    reasons: string[];
  };
}

type LyricsSyncLevel = "plain" | "line_level" | "word_level" | "syllable_level";

/**
 * Server-side lyrics providers for the web port's /v1 lyrics stream.
 *
 * The desktop app's backend streams lyrics from its own provider pool
 * (lrclib, kugou, musixmatch, netease — see upstream lyricsCache tests).
 * The web port cannot reach that backend, so this module implements the
 * open ones server-side and speaks the same SSE contract the SPA's
 * `api.streamLyrics()` already parses:
 *
 *   data: {"type":"provider","provider":"lrclib","status":"found",...}\n\n
 *   data: {"type":"done","cached":false,"best":{...}}\n\n
 *
 * Providers, in priority order:
 *  - lrclib  (https://lrclib.net — open, no auth; /api/get exact match
 *             first, /api/search fallback). Covers the mainstream catalog
 *             including line-synced LRC for most releases.
 *
 * netease was tested and is gated behind phone verification for server
 * IPs; kugou needs a hashed hash-lookup chain; musixmatch needs session
 * tokens — all three are skipped until a working anonymous path exists.
 */

export interface LyricsHint {
  title: string;
  artist: string;
  durationMs?: number;
}

interface LrcLibHit {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number | null; // seconds
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

const LRCLIB_UA = "Liner Web Port (https://github.com/tryliner/desktop)";
const LRCLIB_TIMEOUT_MS = 7_000;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/['’`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  // cheap token overlap — good enough to rank search hits
  const xs = new Set(x.split(" "));
  const ys = new Set(y.split(" "));
  let shared = 0;
  for (const token of xs) if (ys.has(token)) shared += 1;
  return shared / Math.max(xs.size, ys.size);
}

function durationScore(hintMs: number | undefined, seconds: number | null): number {
  if (!hintMs || hintMs <= 0 || !seconds || seconds <= 0) return 0.5;
  const delta = Math.abs(hintMs / 1000 - seconds);
  if (delta <= 2) return 1;
  if (delta <= 5) return 0.8;
  if (delta <= 12) return 0.5;
  return 0.1;
}

function countLyricLines(content: string): number {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^\[\d+:\d+(?:\.\d+)?\]$/.test(line)).length;
}

function buildCandidate(
  provider: string,
  hit: LrcLibHit,
  hint: LyricsHint,
  syncLevel: LyricsSyncLevel,
  content: string,
): LyricsCandidate {
  const titleSim = similarity(hit.trackName ?? "", hint.title);
  const artistSim = similarity(hit.artistName ?? "", hint.artist);
  const durSim = durationScore(hint.durationMs, hit.duration);
  const match = Math.round(titleSim * 15 + artistSim * 10 + durSim * 5);

  const lines = countLyricLines(content);
  const contentScore = lines >= 15 ? 25 : lines >= 8 ? 20 : lines > 0 ? 12 : 0;
  const syncScore = syncLevel === "line_level" ? 30 : 8;
  const source = 15;

  const reasons: string[] = [];
  if (titleSim >= 0.8) reasons.push("matched title");
  if (artistSim >= 0.8) reasons.push("matched artist");
  if (durSim >= 0.8) reasons.push("matched duration");
  if (syncLevel === "line_level") reasons.push("line synced");
  reasons.push(`${lines} lines`);

  return {
    matchedTrack: {
      title: hit.trackName,
      artists: hit.artistName ? [hit.artistName] : [],
      ...(hit.duration ? { durationMs: Math.round(hit.duration * 1000) } : {}),
    },
    lyrics: { format: syncLevel === "line_level" ? "lrc" : "plain", content },
    provider,
    contentKind: syncLevel === "line_level" ? "line_synced" : "plain",
    syncLevel,
    quality: {
      total: match + contentScore + syncScore + source,
      match,
      content: contentScore,
      sync: syncScore,
      source,
      reasons,
    },
  };
}

async function lrclibFetch(
  url: string,
  signal?: AbortSignal,
): Promise<LrcLibHit[] | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": LRCLIB_UA, Accept: "application/json" },
      signal: AbortSignal.any([
        signal ?? AbortSignal.timeout(LRCLIB_TIMEOUT_MS),
        AbortSignal.timeout(LRCLIB_TIMEOUT_MS),
      ]),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    return Array.isArray(body) ? (body as LrcLibHit[]) : [body as LrcLibHit];
  } catch {
    return null;
  }
}

function searchable(hint: LyricsHint): boolean {
  return Boolean(hint.title.trim() && hint.artist.trim());
}

/**
 * Returns the best lrclib candidate (synced preferred over plain) for the
 * hint, or null when the provider has nothing usable.
 */
export async function lrclibCandidate(
  hint: LyricsHint,
  signal?: AbortSignal,
): Promise<LyricsCandidate | null> {
  if (!searchable(hint)) return null;

  const params = new URLSearchParams({
    track_name: hint.title.trim(),
    artist_name: hint.artist.trim(),
  });

  // /api/get is the exact-match endpoint; it can 404 while /api/search finds
  // slightly different spellings (curly quotes, "its" vs "it's"). Try the
  // exact one first, fall back to ranked search.
  const exact = await lrclibFetch(
    `https://lrclib.net/api/get?${params.toString()}`,
    signal,
  );
  const hits = exact && exact.length > 0 ? exact : null;
  const search = hits ? null : await lrclibFetch(
    `https://lrclib.net/api/search?${params.toString()}`,
    signal,
  );

  const pool = (hits ?? search ?? []).filter(
    (hit) =>
      (typeof hit.plainLyrics === "string" && hit.plainLyrics.trim()) ||
      (typeof hit.syncedLyrics === "string" && hit.syncedLyrics.trim()),
  );
  if (pool.length === 0) return null;

  const ranked = pool
    .map((hit) => {
      const synced =
        typeof hit.syncedLyrics === "string" && hit.syncedLyrics.trim()
          ? hit.syncedLyrics
          : null;
      const plain =
        typeof hit.plainLyrics === "string" && hit.plainLyrics.trim()
          ? hit.plainLyrics
          : null;
      // rank by title/artist/duration closeness, synced wins ties
      const titleSim = similarity(hit.trackName ?? "", hint.title);
      const artistSim = similarity(hit.artistName ?? "", hint.artist);
      const durSim = durationScore(hint.durationMs, hit.duration);
      const rank =
        titleSim * 3 + artistSim * 2 + durSim * 2 + (synced ? 0.6 : 0);
      return {
        hit,
        content: synced ?? plain ?? "",
        syncLevel: (synced ? "line_level" : "plain") as LyricsSyncLevel,
        rank,
      };
    })
    .sort((a, b) => b.rank - a.rank);

  const best = ranked[0];
  if (!best.content.trim()) return null;
  return buildCandidate("lrclib", best.hit, hint, best.syncLevel, best.content);
}

export interface LyricsProviderOutcome {
  provider: string;
  candidate: LyricsCandidate | null;
  error?: string;
}

/**
 * Runs every provider in order (each failure just means the next one is
 * tried; errors are surfaced per provider the way the desktop stream does).
 */
export async function collectLyricsCandidates(
  hint: LyricsHint,
  signal?: AbortSignal,
): Promise<LyricsProviderOutcome[]> {
  const outcomes: LyricsProviderOutcome[] = [];
  try {
    outcomes.push({
      provider: "lrclib",
      candidate: await lrclibCandidate(hint, signal),
    });
  } catch (error) {
    outcomes.push({
      provider: "lrclib",
      candidate: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return outcomes;
}
