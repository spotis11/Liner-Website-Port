import { NextRequest, NextResponse } from "next/server";
import { maintenanceGate } from "@/lib/maintenance";
import { verifyAccessToken } from "@/lib/websiteAuth";
import { db } from "@/lib/db";
import { collectLyricsCandidates, type LyricsHint } from "@/lib/lyricsProviders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin backend for the Liner SPA's remaining upstream-shaped endpoints
 * (`/v1/...`). The SPA never talks to api.tryliner.fun from the browser any
 * more — its api base is same-origin — so nothing can be CORS-blocked:
 * same-origin requests have no preflight and no Access-Control rules.
 *
 * Endpoint map:
 *  - /v1/me/recommendations/daily-mixes  built from the signed-in account's
 *                                          liked tracks (artist clusters)
 *  - /v1/explore/popular                 community popular = most-liked tracks
 *                                          across the site's accounts
 *  - /v1/me/history, /v1/me/library/...  clean empty collections for now
 *  - /v1/tracks/:id/lyrics              real lyrics, streamed as SSE from
 *                                        this server's own provider pool
 *                                        (LRCLIB — open, no auth) in the
 *                                        exact event shape the desktop
 *                                        backend uses, so the SPA's
 *                                        streamLyrics() parser consumes it
 *                                        unchanged; /v1/me/lyrics/search
 *                                        stays a clean 404 (the client
 *                                        falls over to its own providers)
 *  - /v1/presence/heartbeat              accepted, client keeps its interval
 *  - everything else                     forwarded server-side to
 *                                          api.tryliner.fun (no preflight, no
 *                                          cookies, no website tokens leave
 *                                          the server); upstream failures
 *                                          surface as plain JSON statuses the
 *                                          client already handles.
 */

const UPSTREAM = "https://api.tryliner.fun";
const FORWARD_TIMEOUT_MS = 6_000;

// Word-level lyrics proxy: the upstream sits behind Cloudflare WAF rules
// (their README warns about it), so the browser's cross-origin GET can be
// CORS-blocked or challenged. The client therefore asks OUR same-origin
// /v1/tracks/:id/lyrics?upstream=1 and this server relays it — same-origin
// means no CORS at all, and the relay presents the desktop's Electron UA
// (the client the upstream expects, verified to pass the WAF).
const UPSTREAM_CLIENT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) liner-desktop/0.2.12 Chrome/134.0.0.0 Electron/44.0.0 Safari/537.36";

// headers the signed upstream protocol needs (signature stays browser-side:
// the browser signs METHOD\npath\nts\nnonce\nsha256(body) over the UPSTREAM
// path, we relay path + headers byte-for-byte, so the signature is valid)
const UPSTREAM_FORWARD_HEADERS = [
  "authorization",
  "x-liner-signature",
  "x-liner-timestamp",
  "x-liner-nonce",
  "x-request-id",
  "x-client-version",
  "x-platform",
  "x-session-id",
  "accept",
] as const;

function upstreamHeaders(req: NextRequest): Headers {
  const headers = new Headers();
  for (const name of UPSTREAM_FORWARD_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("user-agent", UPSTREAM_CLIENT_UA);
  return headers;
}

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

const STRIP_AUTH = new Set(["authorization", "cookie", "host"]);

function forwardableHeaders(req: NextRequest): Headers {
  const headers = new Headers();
  req.headers.forEach((value, name) => {
    if (!STRIP_AUTH.has(name.toLowerCase())) headers.set(name, value);
  });
  return headers;
}

async function forward(req: NextRequest, path: string): Promise<Response> {
  const url = `${UPSTREAM}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: forwardableHeaders(req),
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
      signal: controller.signal,
      // never forward upstream cookies to the browser
      redirect: "manual",
    });
    const body = await upstream.arrayBuffer();
    const contentType = upstream.headers.get("content-type");
    // upstream 403s come back as a Cloudflare HTML challenge — hand the
    // client a clean JSON error instead so it degrades gracefully
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

async function accountIdOf(req: NextRequest): Promise<string | null> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const identity = await verifyAccessToken(bearer);
  return identity?.accountId ?? null;
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
  const accountId = await accountIdOf(req);
  const liked = await likedTracksOf(accountId);
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
  });
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

/**
 * GET /v1/tracks/:id/lyrics?title=&artist=&durationMs= — lyrics as an SSE
 * stream, exactly the contract the SPA's api.streamLyrics() parses (the
 * desktop backend's event shape). The track id itself is ignored: the SPA
 * always sends searchable title/artist hints alongside it. A known
 * instrumental is answered as plain JSON (the client checks content-type
 * before reading the stream) — we cannot know that server-side, so the
 * stream simply ends with status "not_found" instead.
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

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  const { path } = await ctx.params;
  const route = path.join("/");
  const url = new URL(req.url);

  if (route === "me/recommendations/daily-mixes") return dailyMixes(req);
  if (route === "me/history") {
    return NextResponse.json({ items: [], nextCursor: null });
  }
  if (route.startsWith("me/library/")) {
    return NextResponse.json({ items: [] });
  }
  if (route === "me/lyrics/search") {
    // the client catches this 404 and moves on to its remaining providers
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  if (route.startsWith("tracks/") && route.endsWith("/lyrics")) {
    if (url.searchParams.get("upstream") === "1") {
      return upstreamLyrics(req, route, url.search);
    }
    return lyricsStream(url);
  }
  if (route === "explore/popular") {
    const raw = url.searchParams.get("window") ?? "all";
    const window = ["12h", "24h", "7d", "30d", "all"].includes(raw)
      ? raw
      : "all";
    return popularTracks(window);
  }
  if (route === "explore/popular/albums") {
    return NextResponse.json({
      window: url.searchParams.get("window") ?? "7d",
      items: [],
    });
  }
  if (route === "explore/most-saved") {
    return NextResponse.json({
      type: url.searchParams.get("type") ?? "all",
      items: [],
    });
  }
  if (route === "health") {
    return NextResponse.json({ status: "ok", upstream: false });
  }
  return forward(req, `/${route}${url.search}`);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  const { path } = await ctx.params;
  const route = path.join("/");
  if (route === "me/playback/events") {
    // accepted but not persisted yet (upstream-shaped ack, no error)
    return new NextResponse(null, { status: 204 });
  }
  if (route === "presence/heartbeat") {
    // same-origin presence: keep the client on its default cadence
    return new NextResponse(null, {
      status: 204,
      headers: { "x-liner-heartbeat-interval": "60" },
    });
  }
  return forward(req, `/${route}${new URL(req.url).search}`);
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  const { path } = await ctx.params;
  const route = path.join("/");
  if (route.startsWith("me/library/")) {
    return new NextResponse(null, { status: 204 });
  }
  return forward(req, `/${route}${new URL(req.url).search}`);
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  const { path } = await ctx.params;
  const route = path.join("/");
  if (route.startsWith("me/library/")) {
    return new NextResponse(null, { status: 204 });
  }
  return forward(req, `/${route}${new URL(req.url).search}`);
}
