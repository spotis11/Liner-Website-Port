// Server-side track-id resolution for the lyrics relay.
//
// WHY THIS EXISTS: pre-loaded/home-feed tracks and local search hits carry
// LOCAL ids (audius 7-char, itunes numeric, "sc:…" SoundCloud) that the Liner
// upstream has never seen — GET /v1/tracks/:id/lyrics with such an id fails
// fast (400 "params/id must match pattern …[A-Za-z0-9_-]{11}|sc:…") and the
// relay degraded every one of those songs to the local lrclib pool, even for
// upstream-signed-in users (reproduced live 2026-11-15 with "earrings" by
// Malcolm Todd: audius id → lrclib line_level, resolved YouTube id → Polaris
// Mono word_level plus Unison/Wordly/Liner Experimental/Liner options —
// exactly the provider list the real Liner desktop shows).
//
// The upstream's own catalog ids ARE YouTube video ids (the 11-char pattern;
// "earrings" = BI9HQCzpDgQ serves the full word-level provider stream), so
// resolution is: search YouTube Music's innertube (WEB_REMIX, songs filter —
// the same service the SPA's clientCatalog already queries through
// /api/yt/*) for "<title> <artist>" and pick the playable videoId whose
// title/artist best matches the hint.
//
// CANDIDATE SHAPES: YT Music A/B-tests its search responses — during
// verification the accessibilityPlayData labels ("Play Earrings - Malcolm
// Todd") disappeared mid-day while flexColumns ("Earrings", "Malcolm Todd •
// Sweet Boy • 2:32") stayed stable. BOTH are read; the label (when present)
// scores higher than the flexColumns title match, and a candidate with
// NEITHER is skipped: YouTube answers nonsense queries with unlabeled rows,
// and resolving garbage would poison the upstream call with a wrong track.
//
// Results are cached in-process (id resolution for a song is stable; a
// recycled sandbox simply resolves again on the next request).

const YTM_SEARCH_URL = "https://music.youtube.com/youtubei/v1/search?prettyPrint=false";
const YTM_WEB_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
const WEB_REMIX_VERSION = "1.20260911.08.00";
const SEARCH_TIMEOUT_MS = 12_000;
const CACHE_MAX = 500;

/** Upstream Liner track ids: 11-char YouTube videoIds or SoundCloud ids. */
const UPSTREAM_ID_RE = /^(?:[A-Za-z0-9_-]{11}|sc:[1-9][0-9]{0,19})$/;

/** True when a track id is already valid for the upstream lyrics route. */
export function isUpstreamTrackId(id: string): boolean {
  return UPSTREAM_ID_RE.test(id);
}

interface Resolved {
  id: string;
  at: number;
}
const resolvedCache = new Map<string, Resolved>();

function cacheGet(key: string): string | null {
  const hit = resolvedCache.get(key);
  if (!hit) return null;
  // serve any age — ids never change; LRU-style touch keeps hot entries
  resolvedCache.delete(key);
  resolvedCache.set(key, hit);
  return hit.id;
}

function cacheSet(key: string, id: string): void {
  resolvedCache.set(key, { id, at: Date.now() });
  if (resolvedCache.size > CACHE_MAX) {
    const oldest = resolvedCache.keys().next().value;
    if (oldest !== undefined) resolvedCache.delete(oldest);
  }
}

function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

interface WatchCandidate {
  id: string;
  /** "Play <title> - <artist>" accessibility label, when YT sends one */
  label: string;
  /** flexColumns texts: [title, "artist • album • duration", plays] */
  cols: string[];
}

/** Walk the innertube response for playable videoIds with their metadata. */
function collectWatchCandidates(node: unknown, out: WatchCandidate[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collectWatchCandidates(child, out);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;

    // shape 1: musicResponsiveListItemRenderer (stable since forever) —
    // flexColumns carry title + "artist • album • duration"
    const item = obj.musicResponsiveListItemRenderer as
      | Record<string, unknown>
      | undefined;
    if (item) {
      const cols: string[] = [];
      const flex = item.flexColumns;
      if (Array.isArray(flex)) {
        for (const col of flex) {
          const runs = (col as Record<string, unknown>)
            ?.musicResponsiveListItemFlexColumnRenderer as
            | { text?: { runs?: Array<{ text?: string }> } }
            | undefined;
          const text = (runs?.text?.runs ?? [])
            .map((r) => r.text ?? "")
            .join("");
          if (text) cols.push(text);
        }
      }
      const serialized = JSON.stringify(item);
      const vid = serialized.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
      if (vid && !out.some((c) => c.id === vid[1])) {
        out.push({ id: vid[1], label: "", cols });
      }
    }

    // shape 2: play buttons with accessibilityPlayData labels
    const watch = obj.watchEndpoint;
    if (watch && typeof watch === "object") {
      const vid = (watch as Record<string, unknown>).videoId;
      if (typeof vid === "string" && /^[A-Za-z0-9_-]{11}$/.test(vid)) {
        const playData = obj.accessibilityPlayData as
          | { accessibilityData?: { label?: string } }
          | undefined;
        const label = playData?.accessibilityData?.label ?? "";
        const existing = out.find((c) => c.id === vid);
        if (existing) {
          if (label && !existing.label) existing.label = label;
        } else if (label) {
          out.push({ id: vid, label, cols: [] });
        }
      }
    }

    for (const child of Object.values(obj)) collectWatchCandidates(child, out);
  }
}

function titleScore(
  candidateTitle: string,
  candidateArtistLine: string,
  wantTitle: string,
  wantArtist: string,
): number {
  const gotTitle = normalizeLabel(candidateTitle);
  if (!gotTitle) return 0;
  let score = 0;
  if (gotTitle === wantTitle) score = 60;
  else if (gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle)) score = 45;
  else {
    // token overlap — tolerates "(Slowed + Reverb)" suffixes and typos
    const tokens = gotTitle.split(" ");
    const wantTokens = wantTitle.split(" ");
    const shared = tokens.filter((t) => wantTokens.includes(t)).length;
    if (shared === 0 || wantTokens.length === 0) return 0;
    score = Math.round(30 * (shared / Math.max(tokens.length, wantTokens.length)));
    if (score < 15) return 0;
  }
  // artist confirmation from the "artist • album • duration" column
  const artistLine = normalizeLabel(candidateArtistLine);
  if (artistLine && wantArtist) {
    const artistTokens = wantArtist.split(" ");
    const shared = artistTokens.filter((t) => artistLine.includes(t)).length;
    if (shared > 0) score += 25;
    if (shared === artistTokens.length) score += 10;
  }
  return score;
}

/**
 * Resolve the upstream (YouTube) track id for a title/artist pair via the
 * YT Music innertube search. Returns null when nothing plausible is found —
 * callers keep their existing fallback (lrclib pool) in that case.
 */
export async function resolveUpstreamTrackId(
  title: string,
  artist: string,
): Promise<string | null> {
  const cleanTitle = title.trim();
  const cleanArtist = artist.trim();
  if (!cleanTitle || !cleanArtist) return null;

  const key = `${normalizeLabel(cleanTitle)}::${normalizeLabel(cleanArtist)}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const query = `${cleanTitle} ${cleanArtist}`.trim();
  try {
    const res = await fetch(YTM_SEARCH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://music.youtube.com",
        referer: "https://music.youtube.com/",
        "user-agent": YTM_WEB_UA,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB_REMIX",
            clientVersion: WEB_REMIX_VERSION,
            hl: "en",
            gl: "US",
          },
        },
        query,
        // songs filter — the same params the SPA's innertubeSearch uses
        params: "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D",
      }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;

    const candidates: WatchCandidate[] = [];
    collectWatchCandidates(body, candidates);
    if (candidates.length === 0) return null;

    const wantTitle = normalizeLabel(cleanTitle);
    const wantArtist = normalizeLabel(cleanArtist);

    let best: { id: string; score: number } | null = null;
    for (const candidate of candidates) {
      let score = 0;
      // the accessibility label is the strongest signal when present
      if (candidate.label.trim()) {
        const got = normalizeLabel(candidate.label);
        const want = `play ${wantTitle} ${wantArtist}`;
        if (got === want) score = 100;
        else if (got.includes(want) || want.includes(got)) score = 85;
        else if (got.includes(wantTitle)) score = 65;
      }
      // flexColumns title/artist match — the stable shape
      if (score < 60 && candidate.cols.length >= 2) {
        score = Math.max(
          score,
          titleScore(candidate.cols[0], candidate.cols[1] ?? "", wantTitle, wantArtist),
        );
      }
      // an empty candidate (no label, no cols) can never be trusted —
      // YouTube returns such rows for nonsense queries
      if (score === 0) continue;
      if (!best || score > best.score) best = { id: candidate.id, score };
    }
    if (!best || best.score < 30) return null;
    cacheSet(key, best.id);
    return best.id;
  } catch {
    return null;
  }
}
