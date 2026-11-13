import { NextRequest, NextResponse } from "next/server";
import { maintenanceGate } from "@/lib/maintenance";
import { collectLyricsCandidates, type LyricsHint } from "@/lib/lyricsProviders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin backend for the Liner SPA's ENTIRE upstream surface (`/v1/...`).
 *
 * UPSTREAM-PARITY TEST (v1.25): everything — auth, catalog, library,
 * playlists, playback, history, explore, presence — is served by the real
 * Liner API (api.tryliner.fun). The SPA never talks to it from the browser:
 * its api base is same-origin, this handler relays. Same-origin requests have
 * no preflight and no Access-Control rules, so nothing can be CORS-blocked.
 *
 * The browser signs METHOD\npath\nts\nnonce\nsha256(body) over the UPSTREAM
 * path (desktop's native signer constants); this relay forwards path +
 * x-liner-* headers byte-for-byte, so the signature stays valid end to end.
 * Every relayed request presents the desktop's Electron UA — the client the
 * upstream's Cloudflare WAF expects (their README warns about the WAF; the
 * browser's cross-origin calls can be challenged, this server's relay passes).
 *
 * Kept local (not upstream):
 *  - /v1/tracks/:id/lyrics  WITHOUT ?upstream=1 — this server's own provider
 *    pool (LRCLIB), the signed-out fallback; WITH ?upstream=1 — relayed SSE
 *  - /v1/health — connectivity probe answer for the SPA's offline-mode logic
 * Revert: git revert of the v1.25 commits restores the website-account stubs.
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

function upstreamHeaders(req: NextRequest): Headers {
  const headers = new Headers();
  for (const name of UPSTREAM_FORWARD_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("user-agent", UPSTREAM_CLIENT_UA);
  return headers;
}

async function forward(req: NextRequest, path: string): Promise<Response> {
  const url = `${UPSTREAM}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  // buffer the body: undici requires `duplex` for stream bodies and a
  // ReadableStream from NextRequest can be flaky across the relay — bytes
  // are small (JSON) and always safe
  const hasBody = !["GET", "HEAD"].includes(req.method);
  const bodyBytes = hasBody ? await req.arrayBuffer().catch(() => null) : null;
  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: upstreamHeaders(req),
      body: bodyBytes && bodyBytes.byteLength > 0 ? bodyBytes : undefined,
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

// /v1/auth/verify — the human-check page (Turnstile) is HTML by design and
// talks to the SPA via postMessage; it must pass through unwrapped
async function passthrough(req: NextRequest, path: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    const upstream = await fetch(`${UPSTREAM}${path}`, {
      method: req.method,
      headers: upstreamHeaders(req),
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
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
 * the exact event shape the desktop backend uses. This is the signed-out
 * fallback; signed-in users are served upstream-first (?upstream=1) and only
 * land here when the upstream fails.
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

async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const gate = await maintenanceGate();
  if (gate) return gate;
  const { path } = await ctx.params;
  const route = path.join("/");
  const url = new URL(req.url);

  if (route === "health") {
    // connectivity probe for the SPA's offline logic — same-origin answer,
    // no upstream round-trip
    return NextResponse.json({ status: "ok", upstream: true });
  }
  if (route.startsWith("tracks/") && route.endsWith("/lyrics")) {
    if (url.searchParams.get("upstream") === "1") {
      return upstreamLyrics(req, route, url.search);
    }
    return lyricsStream(url);
  }
  if (route === "auth/verify") {
    return passthrough(req, `/v1/${route}${url.search}`);
  }
  return forward(req, `/v1/${route}${url.search}`);
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return handle(req, ctx);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return handle(req, ctx);
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return handle(req, ctx);
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return handle(req, ctx);
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return handle(req, ctx);
}

export async function HEAD(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return handle(req, ctx);
}
