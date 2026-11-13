import { NextRequest, NextResponse } from "next/server";
import { maintenanceGate } from "@/lib/maintenance";
import { verifyAccessToken } from "@/lib/websiteAuth";
import { db } from "@/lib/db";
import { overlayWebsitePro } from "@/lib/linerProOverlay";
import { collectLyricsCandidates, type LyricsHint } from "@/lib/lyricsProviders";

// website route handlers reused directly (same process, no HTTP hop): the
// website session surface the SPA needs is exactly the pre-v1.25 /api/*
// backend, so the dual-mode relay calls those handlers with rewritten paths.
import { GET as websiteMeGET } from "@/app/api/auth/me/route";
import { PATCH as websiteProfilePATCH } from "@/app/api/auth/profile/route";
import { POST as websiteRefreshPOST } from "@/app/api/auth/refresh/route";
import { POST as websiteLogoutPOST } from "@/app/api/auth/logout/route";
import {
  GET as websiteLikedGET,
  PUT as websiteLikedPUT,
  DELETE as websiteLikedDELETE,
} from "@/app/api/library/tracks/route";
import {
  GET as websitePlaylistsGET,
  POST as websitePlaylistsPOST,
} from "@/app/api/library/playlists/route";
import {
  GET as websitePlaylistGET,
  PATCH as websitePlaylistPATCH,
  DELETE as websitePlaylistDELETE,
} from "@/app/api/library/playlists/[id]/route";
import { POST as websitePlaylistTracksPOST } from "@/app/api/library/playlists/[id]/tracks/route";
import {
  POST as websitePlaylistTrackPOST,
  DELETE as websitePlaylistTrackDELETE,
} from "@/app/api/library/playlists/[id]/tracks/[trackId]/route";
import { DELETE as websitePlaylistItemDELETE } from "@/app/api/library/playlists/[id]/items/[itemId]/route";
import { POST as websitePlaylistItemMovePOST } from "@/app/api/library/playlists/[id]/items/[itemId]/move/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin backend for the Liner SPA's ENTIRE upstream surface (`/v1/...`).
 *
 * DUAL-MODE (v1.26): two session trust domains share one /v1 surface.
 *
 * 1. UPSTREAM sessions (real Liner accounts, api.tryliner.fun tokens — the
 *    v1.25 "everything via tryliner" test): every request is relayed to the
 *    upstream with the desktop's Electron UA (their README warns about the
 *    Cloudflare WAF; the server-side relay passes). The browser signs
 *    METHOD\npath\nts\nnonce\nsha256(body) over the UPSTREAM path; this relay
 *    forwards path + x-liner-* headers byte-for-byte, so the signature stays
 *    valid end to end. GET /v1/me (and auth responses that embed a user) get
 *    this website's Liner Pro flag overlaid by username — the site owner
 *    (jayzeyluna) is Pro forever and owner-granted accounts keep their tier.
 *
 * 2. WEBSITE sessions (Discord-OAuth and guest accounts — tokens minted by
 *    this port's own backend, always `at_`/`rt_`-prefixed): those tokens mean
 *    nothing to the upstream, so the relay serves them from the website's own
 *    database by delegating to the same handlers behind /api/auth and
 *    /api/library (likes, playlists, profile, refresh, logout) plus the
 *    community surfaces (daily mixes, explore/popular) built from the site's
 *    likes. Anonymous catalog surfaces (search, albums, artists) still forward
 *    upstream, with every authorization/website header stripped.
 *
 * Kept local in BOTH modes:
 *  - /v1/tracks/:id/lyrics  WITHOUT ?upstream=1 — this server's own provider
 *    pool (LRCLIB), the signed-out/website fallback; WITH ?upstream=1 —
 *    relayed SSE (upstream mode only, needs a real Liner bearer)
 *  - /v1/health — connectivity probe answer for the SPA's offline-mode logic
 * Revert: git revert of the v1.25/v1.26 commits restores the single-mode relay.
 */

const UPSTREAM = "https://api.tryliner.fun";
const FORWARD_TIMEOUT_MS = 20_000;

const UPSTREAM_CLIENT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) liner-desktop/0.2.12 Chrome/134.0.0.0 Electron/44.0.0 Safari/537.36";

// signed upstream protocol + correlation headers (signature stays
// browser-side: the browser signs over the UPSTREAM path, we relay path +
// headers byte-for-byte, so the signature is valid)
const UPSTREAM_FORWARD_HEADERS = [
  "authorization",
  "x-liner-signature",
  "x-liner-timestamp",
  "x-liner-nonce",
  "x-request-id",
  "x-client-version",
  "x-platform",
  "x-session-id",
  "x-user-id",
  "x-user-name",
  "content-type",
  "if-none-match",
  "accept",
] as const;

// website tokens must never reach the upstream — these are stripped when a
// request is forwarded anonymously (website-mode catalog fallback)
const STRIP_FOR_ANONYMOUS = new Set([
  "authorization",
  "cookie",
  "host",
  "x-liner-signature",
  "x-liner-timestamp",
  "x-liner-nonce",
  "x-user-id",
  "x-user-name",
  "x-session-id",
]);

/** Website access/refresh tokens are always `at_`/`rt_`-prefixed. */
function isWebsiteToken(token: string | null | undefined): boolean {
  return typeof token === "string" && /^(at_|rt_)/.test(token);
}

function upstreamHeaders(req: NextRequest): Headers {
  const headers = new Headers();
  for (const name of UPSTREAM_FORWARD_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("user-agent", UPSTREAM_CLIENT_UA);
  return headers;
}

function anonymousHeaders(req: NextRequest): Headers {
  const headers = new Headers();
  req.headers.forEach((value, name) => {
    if (!STRIP_FOR_ANONYMOUS.has(name.toLowerCase())) headers.set(name, value);
  });
  headers.set("user-agent", UPSTREAM_CLIENT_UA);
  return headers;
}

async function bufferBody(req: NextRequest): Promise<ArrayBuffer | null> {
  if (["GET", "HEAD"].includes(req.method)) return null;
  return req.arrayBuffer().catch(() => null);
}

/** Routes whose relayed response may embed a Liner user worth Pro-upgrading. */
function shouldOverlayPro(route: string, method: string): boolean {
  if (method === "GET" && route === "me") return true;
  if (
    method === "POST" &&
    (route === "auth/login" || route === "auth/register" || route === "auth/refresh")
  ) {
    return true;
  }
  if (method === "PATCH" && route === "users/me") return true;
  return false;
}

async function forward(
  req: NextRequest,
  path: string,
  overlay: boolean = false,
  bodyBytes?: ArrayBuffer | null,
): Promise<Response> {
  const url = `${UPSTREAM}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  // the body is buffered ONCE in handle() (NextRequest streams read once);
  // undici requires `duplex` for stream bodies and a ReadableStream from
  // NextRequest can be flaky across the relay — bytes are small (JSON) and
  // always safe
  const bytes = bodyBytes !== undefined ? bodyBytes : await bufferBody(req);
  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: upstreamHeaders(req),
      body: bytes && bytes.byteLength > 0 ? bytes : undefined,
      signal: controller.signal,
      // never forward upstream cookies to the browser
      redirect: "manual",
    });
    let body = await upstream.arrayBuffer();
    const contentType = upstream.headers.get("content-type");
    // upstream 403s come back as a Cloudflare HTML challenge — hand the
    // client a clean JSON error instead so it degrades gracefully
    if (contentType?.includes("text/html")) {
      return NextResponse.json(
        { error: "Upstream unavailable.", code: "UPSTREAM_BLOCKED" },
        { status: upstream.status === 403 ? 503 : upstream.status },
      );
    }
    if (overlay && upstream.status === 200) {
      body = await overlayWebsitePro(body, contentType);
    }
    const res = new NextResponse(body, {
      status: upstream.status,
      statusText: upstream.statusText,
    });
    if (contentType) res.headers.set("content-type", contentType);
    // let the browser sync its signing clock from the upstream Date header
    for (const name of ["date", "x-request-id", "retry-after"] as const) {
      const value = upstream.headers.get(name);
      if (value) res.headers.set(name, value);
    }
    return res;
  } catch {
    return NextResponse.json(
      { error: "Upstream unreachable.", code: "UPSTREAM_UNREACHABLE" },
      { status: 503 },
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Website-mode anonymous forward: catalog etc., with tokens stripped. */
async function forwardAnonymous(
  req: NextRequest,
  path: string,
  bodyBytes?: ArrayBuffer | null,
): Promise<Response> {
  const url = `${UPSTREAM}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  const bytes = bodyBytes !== undefined ? bodyBytes : await bufferBody(req);
  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: anonymousHeaders(req),
      body: bytes && bytes.byteLength > 0 ? bytes : undefined,
      signal: controller.signal,
      redirect: "manual",
    });
    const body = await upstream.arrayBuffer();
    const contentType = upstream.headers.get("content-type");
    if (contentType?.includes("text/html")) {
      return NextResponse.json(
        { error: "Upstream unavailable.", code: "UPSTREAM_BLOCKED" },
        { status: upstream.status === 403 ? 503 : upstream.status },
      );
    }
    const res = new NextResponse(body, {
      status: upstream.status,
      statusText: upstream.statusText,
    });
    if (contentType) res.headers.set("content-type", contentType);
    return res;
  } catch {
    return NextResponse.json(
      { error: "Upstream unreachable.", code: "UPSTREAM_UNREACHABLE" },
      { status: 503 },
    );
  } finally {
    clearTimeout(timer);
  }
}

// /v1/auth/verify — the human-check page (Turnstile) is HTML by design and
// talks to the SPA via postMessage; it must pass through unwrapped
async function passthrough(
  req: NextRequest,
  path: string,
  bodyBytes?: ArrayBuffer | null,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  const bytes = bodyBytes !== undefined ? bodyBytes : await bufferBody(req);
  try {
    const upstream = await fetch(`${UPSTREAM}${path}`, {
      method: req.method,
      headers: upstreamHeaders(req),
      body: bytes && bytes.byteLength > 0 ? bytes : undefined,
      signal: controller.signal,
      redirect: "manual",
    });
    const headers = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    headers.set("cache-control", "no-store");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch {
    return NextResponse.json(
      { error: "Upstream unreachable.", code: "UPSTREAM_UNREACHABLE" },
      { status: 503 },
    );
  } finally {
    clearTimeout(timer);
  }
}

// Word-level lyrics proxy: the upstream sits behind Cloudflare WAF rules
// (their README warns about it), so the browser's cross-origin GET can be
// CORS-blocked or challenged. The client asks OUR same-origin
// /v1/tracks/:id/lyrics?upstream=1 and this server relays it.
async function upstreamLyrics(
  req: NextRequest,
  route: string,
  search: string,
): Promise<Response> {
  // word-level providers are served ONLY to signed-in Liner accounts; a
  // bearer-less proxy call is pointless — serve the local pool instead
  if (!req.headers.get("authorization")) {
    return lyricsStream(new URL(req.url));
  }
  try {
    const upstream = await fetch(`${UPSTREAM}/v1/${route}${search}`, {
      method: "GET",
      headers: upstreamHeaders(req),
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(60_000)]),
      redirect: "manual",
    });
    const contentType = upstream.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      // Cloudflare challenge page — the client falls over to the local pool
      return NextResponse.json(
        { error: "Upstream unavailable.", code: "UPSTREAM_BLOCKED" },
        { status: 503 },
      );
    }
    const headers = new Headers();
    if (contentType) headers.set("content-type", contentType);
    headers.set("cache-control", "no-cache, no-transform");
    for (const name of ["date", "x-request-id", "retry-after"] as const) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    // true streaming passthrough — the SSE events reach the player live
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch {
    return NextResponse.json(
      { error: "Upstream unreachable.", code: "UPSTREAM_UNREACHABLE" },
      { status: 503 },
    );
  }
}

/**
 * GET /v1/tracks/:id/lyrics?title=&artist=&durationMs= — lyrics as an SSE
 * stream from this server's own provider pool (LRCLIB — open, no auth), in
 * the exact event shape the desktop backend uses. This is the signed-out /
 * website-session fallback; upstream-signed-in users are served
 * upstream-first (?upstream=1) and only land here when the upstream fails.
 */
function lyricsStream(url: URL): Response {
  const hint: LyricsHint = {
    title: (url.searchParams.get("title") ?? "").trim(),
    artist: (url.searchParams.get("artist") ?? "").trim(),
    durationMs: Number(url.searchParams.get("durationMs")) || undefined,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      try {
        const outcomes = await collectLyricsCandidates(hint);
        let best: { provider: string; quality: number; syncLevel: string } | null =
          null;
        for (const outcome of outcomes) {
          if (outcome.candidate && !best) {
            best = {
              provider: outcome.candidate.provider,
              quality: outcome.candidate.quality.total,
              syncLevel: outcome.candidate.syncLevel,
            };
          }
          send(
            outcome.candidate
              ? {
                  type: "provider",
                  provider: outcome.provider,
                  status: "found",
                  syncLevel: outcome.candidate.syncLevel,
                  candidate: outcome.candidate,
                  ...(hint.durationMs ? { durationMs: hint.durationMs } : {}),
                }
              : {
                  type: "provider",
                  provider: outcome.provider,
                  status: outcome.error ? "error" : "not_found",
                  ...(outcome.error ? { message: outcome.error } : {}),
                  ...(hint.durationMs ? { durationMs: hint.durationMs } : {}),
                },
          );
        }
        send(
          best
            ? { type: "done", cached: false, best }
            : { type: "done", cached: false, status: "not_found" },
        );
      } catch {
        send({ type: "done", cached: false, status: "not_found" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

// ---------------------------------------------------------------------------
// WEBSITE MODE — /v1 handlers for website sessions (`at_`/`rt_` tokens),
// served by delegating to the same logic behind the /api/* routes.
// ---------------------------------------------------------------------------

/** A NextRequest retargeted at the website's own /api path, same auth. */
function websiteRequest(
  req: NextRequest,
  apiPath: string,
  bodyBytes?: ArrayBuffer | null,
): NextRequest {
  const origin = new URL(req.url).origin;
  const headers = new Headers();
  const auth = req.headers.get("authorization");
  if (auth) headers.set("authorization", auth);
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const hasBody =
    bodyBytes && bodyBytes.byteLength > 0 && !["GET", "HEAD"].includes(req.method);
  return new NextRequest(new URL(apiPath, origin), {
    method: req.method,
    headers,
    ...(hasBody ? { body: bodyBytes } : {}),
  } as never);
}

async function websiteDispatch(
  req: NextRequest,
  route: string,
  search: string,
  bodyBytes: ArrayBuffer | null,
): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method;
  const q = (path: string) => websiteRequest(req, path, bodyBytes);

  // auth + profile
  if (route === "me" && method === "GET") return websiteMeGET(q("/api/auth/me"));
  if (route === "users/me" && method === "PATCH") {
    return websiteProfilePATCH(q("/api/auth/profile"));
  }
  if (route === "auth/refresh" && method === "POST") {
    return websiteRefreshPOST(q("/api/auth/refresh"));
  }
  if (route === "auth/logout" && method === "POST") {
    return websiteLogoutPOST(q("/api/auth/logout"));
  }

  // liked tracks
  if (route === "me/library/tracks" && method === "GET") {
    return websiteLikedGET(q(`/api/library/tracks${search}`));
  }
  if (route === "me/library/tracks" && method === "PUT") {
    return websiteLikedPUT(q("/api/library/tracks"));
  }
  const likedTrackMatch = route.match(/^me\/library\/tracks\/([^/]+)$/);
  if (likedTrackMatch) {
    const trackId = likedTrackMatch[1];
    if (method === "PUT") return websiteLikedPUT(q("/api/library/tracks"));
    if (method === "DELETE") {
      return websiteLikedDELETE(
        q(`/api/library/tracks?trackId=${encodeURIComponent(trackId)}`),
      );
    }
  }

  // playlists
  if (route === "me/playlists" && method === "GET") {
    return websitePlaylistsGET(q("/api/library/playlists"));
  }
  if (route === "me/playlists" && method === "POST") {
    return websitePlaylistsPOST(q("/api/library/playlists"));
  }
  const playlistMatch = route.match(/^me\/playlists\/([^/]+)(\/(tracks|items)(\/([^/]+))?(\/move)?)?$/);
  if (playlistMatch) {
    const id = playlistMatch[1];
    const kind = playlistMatch[3];
    const sub = playlistMatch[5];
    const isMove = Boolean(playlistMatch[6]);
    const dynId = { params: Promise.resolve({ id }) } as never;
    if (!kind) {
      if (method === "GET") {
        return websitePlaylistGET(q(`/api/library/playlists/${id}${search}`), dynId);
      }
      if (method === "PATCH") {
        return websitePlaylistPATCH(q("/api/library/playlists"), dynId);
      }
      if (method === "DELETE") {
        return websitePlaylistDELETE(q("/api/library/playlists"), dynId);
      }
    }
    if (kind === "tracks" && !sub && method === "POST") {
      return websitePlaylistTracksPOST(q("/api/library/playlists"), dynId);
    }
    if (kind === "tracks" && sub) {
      const dynTrack = {
        params: Promise.resolve({ id, trackId: sub }),
      } as never;
      if (method === "POST") {
        return websitePlaylistTrackPOST(q("/api/library/playlists"), dynTrack);
      }
      if (method === "DELETE") {
        return websitePlaylistTrackDELETE(q("/api/library/playlists"), dynTrack);
      }
    }
    if (kind === "items" && sub && !isMove && method === "DELETE") {
      const dynItem = {
        params: Promise.resolve({ id, itemId: sub }),
      } as never;
      return websitePlaylistItemDELETE(q("/api/library/playlists"), dynItem);
    }
    if (kind === "items" && sub && isMove && method === "POST") {
      const dynMove = {
        params: Promise.resolve({ id, itemId: sub }),
      } as never;
      return websitePlaylistItemMovePOST(q("/api/library/playlists"), dynMove);
    }
  }

  // community + filler surfaces (website-shaped, cheap)
  if (route === "me/history" && method === "GET") {
    return NextResponse.json({ items: [], nextCursor: null });
  }
  if (route === "me/recommendations/daily-mixes" && method === "GET") {
    return dailyMixes(req);
  }
  if (route === "explore/popular" && method === "GET") {
    const raw = url.searchParams.get("window") ?? "all";
    const window = ["12h", "24h", "7d", "30d", "all"].includes(raw)
      ? raw
      : "all";
    return popularTracks(window);
  }
  if (route === "explore/popular/albums" && method === "GET") {
    return NextResponse.json({
      window: url.searchParams.get("window") ?? "7d",
      items: [],
    });
  }
  if (route === "explore/most-saved" && method === "GET") {
    return NextResponse.json({
      type: url.searchParams.get("type") ?? "all",
      items: [],
    });
  }
  if (route === "me/lyrics/search") {
    // the client catches this 404 and moves on to its remaining providers
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  if (route === "me/playback/events" && method === "POST") {
    return new NextResponse(null, { status: 204 });
  }
  if (route === "presence/heartbeat" && method === "POST") {
    return new NextResponse(null, {
      status: 204,
      headers: { "x-liner-heartbeat-interval": "60" },
    });
  }
  if (route.startsWith("me/library/")) {
    // saved albums/artists/playlists collections — accepted, stored empty
    if (method === "GET") return NextResponse.json({ items: [] });
    if (method === "PUT" || method === "DELETE") {
      return new NextResponse(null, { status: 204 });
    }
  }

  // anonymous catalog/social fallbacks (website tokens stay local)
  return forwardAnonymous(req, `/v1/${route}${search}`, bodyBytes);
}

interface LikedSnapshot {
  trackId: string;
  artist: string;
  snapshot: string | null;
  likedAt: Date;
}

async function likedTracksOf(accountId: string | null): Promise<LikedSnapshot[]> {
  if (!accountId) return [];
  const rows = await db.accountTrack.findMany({
    where: { accountId },
    orderBy: { likedAt: "desc" },
    take: 500,
    select: { trackId: true, artist: true, snapshot: true, likedAt: true },
  });
  return rows;
}

/**
 * GET /v1/me/recommendations/daily-mixes — daily mixes built from the
 * account's liked tracks, clustered by primary artist (up to 4 mixes).
 */
async function dailyMixes(req: NextRequest): Promise<NextResponse> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const identity = await verifyAccessToken(bearer).catch(() => null);
  const liked = await likedTracksOf(identity?.accountId ?? null);
  const clusters = new Map<string, LikedSnapshot[]>();
  for (const row of liked) {
    const artist = (row.artist || "Unknown artist").trim() || "Unknown artist";
    const list = clusters.get(artist) ?? [];
    list.push(row);
    clusters.set(artist, list);
  }
  const ordered = [...clusters.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  const mixes = ordered.slice(0, 4).map(([artist, rows], index) => {
    const tracks = rows
      .slice(0, 10)
      .map((row) => (row.snapshot ? JSON.parse(row.snapshot) : null))
      .filter(Boolean);
    return {
      id: `daily-mix-${index + 1}`,
      title: `Daily Mix ${index + 1}`,
      description: `Made for you — more like ${artist}`,
      clusterArtists: [artist],
      trackCount: tracks.length,
      tracks,
    };
  });
  return NextResponse.json({
    items: mixes,
    generatedAt: new Date().toISOString(),
  });
}

/**
 * GET /v1/explore/popular — community popular: tracks most liked across all
 * accounts on this site (real, playable catalog tracks).
 */
async function popularTracks(window: string): Promise<NextResponse> {
  const rows = await db.accountTrack.groupBy({
    by: ["trackId"],
    _count: { trackId: true },
    orderBy: { _count: { trackId: "desc" } },
    take: 40,
  }).catch(() => []);
  if (rows.length === 0) {
    return NextResponse.json({
      window,
      generatedAt: new Date().toISOString(),
      items: [],
    });
  }
  const ids = rows.map((row) => row.trackId);
  const liked = await db.accountTrack.findMany({
    where: { trackId: { in: ids } },
    orderBy: { likedAt: "desc" },
  });
  const byId = new Map<string, string | null>();
  for (const row of liked) {
    if (!byId.has(row.trackId)) byId.set(row.trackId, row.snapshot);
  }
  const items = rows
    .map((row, index) => {
      const snapshot = byId.get(row.trackId);
      const track = snapshot ? JSON.parse(snapshot) : null;
      if (!track) return null;
      const likeCount = row._count.trackId;
      return {
        rank: index + 1,
        track,
        playCount: likeCount,
        uniqueListeners: likeCount,
        score: likeCount,
      };
    })
    .filter(Boolean)
    .slice(0, 20);
  return NextResponse.json({
    window,
    generatedAt: new Date().toISOString(),
    items,
  });
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const gate = await maintenanceGate();
  if (gate) return gate;
  const { path } = await ctx.params;
  const route = (path ?? []).join("/");
  const url = new URL(req.url);

  if (route === "health") {
    // connectivity probe for the SPA's offline logic — same-origin answer,
    // no upstream round-trip
    return NextResponse.json({ status: "ok", upstream: true });
  }

  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const bodyBytes = await bufferBody(req);

  // Website-session refresh/logout are recognized even without an at_ Bearer
  // (old bundles hardcode the /v1/auth endpoints — the rt_ in the body is the
  // tell), so a stale bundle can never push website tokens at the upstream.
  if (route === "auth/refresh" && !bearer && bodyBytes && bodyBytes.byteLength > 0) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bodyBytes)) as Record<string, unknown>;
      if (typeof parsed?.refreshToken === "string" && isWebsiteToken(parsed.refreshToken)) {
        return websiteRefreshPOST(websiteRequest(req, "/api/auth/refresh", bodyBytes));
      }
    } catch {}
  }
  if (route === "auth/logout" && !bearer && bodyBytes && bodyBytes.byteLength > 0) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bodyBytes)) as Record<string, unknown>;
      if (typeof parsed?.refreshToken === "string" && isWebsiteToken(parsed.refreshToken)) {
        return websiteLogoutPOST(websiteRequest(req, "/api/auth/logout", bodyBytes));
      }
    } catch {}
  }

  // WEBSITE MODE — website sessions get the website's own backend
  if (isWebsiteToken(bearer)) {
    if (route.startsWith("tracks/") && route.endsWith("/lyrics")) {
      // website tokens mean nothing upstream — local provider pool only
      return lyricsStream(url);
    }
    return websiteDispatch(req, route, url.search, bodyBytes);
  }

  // UPSTREAM MODE — real Liner sessions relayed to api.tryliner.fun
  if (route.startsWith("tracks/") && route.endsWith("/lyrics")) {
    if (url.searchParams.get("upstream") === "1") {
      return upstreamLyrics(req, route, url.search);
    }
    return lyricsStream(url);
  }
  if (route === "auth/verify") {
    return passthrough(req, `/v1/${route}${url.search}`, bodyBytes);
  }
  return forward(
    req,
    `/v1/${route}${url.search}`,
    shouldOverlayPro(route, req.method),
    bodyBytes,
  );
}

type RelayCtx = { params: Promise<{ path?: string[] }> };

export async function GET(
  req: NextRequest,
  ctx: RelayCtx,
) {
  return handle(req, ctx);
}

export async function POST(
  req: NextRequest,
  ctx: RelayCtx,
) {
  return handle(req, ctx);
}

export async function PUT(
  req: NextRequest,
  ctx: RelayCtx,
) {
  return handle(req, ctx);
}

export async function PATCH(
  req: NextRequest,
  ctx: RelayCtx,
) {
  return handle(req, ctx);
}

export async function DELETE(
  req: NextRequest,
  ctx: RelayCtx,
) {
  return handle(req, ctx);
}

export async function HEAD(
  req: NextRequest,
  ctx: RelayCtx,
) {
  return handle(req, ctx);
}
