// Liner web port: SABR UMP streaming proxy.
//
// The signed-in TV playback chain (prepareTvDownload -> SabrStream) POSTs a
// protobuf VideoPlaybackAbrRequest to the player response's
// serverAbrStreamingUrl (https://www.youtube.com/api/manifest/sabr/...) and
// reads the application/vnd.yt-ump response as a PROGRESSIVE stream — media
// chunks arrive continuously while playback advances, and the SabrStream
// watchdog (30s, reset on every received chunk) aborts the request the moment
// no data shows up.
//
// The generic /api/fetch proxy cannot carry these requests: it buffers the
// entire upstream body before responding and 30s-times-out the upstream fetch,
// so the browser receives zero bytes until it is far too late ("Request timed
// out"). /api/media is GET/HEAD-only. The desktop never hit this because
// Electron opens CORS on every response and fetches Google hosts directly.
//
// This route streams the upstream response body through 1:1 (no buffering) so
// chunk delivery timing — the property SabrStream depends on — is preserved.
//
// Usage: POST /api/yt/sabr?u=<urlencoded /api/manifest/... URL on
//        youtube.com / googlevideo.com hosts>

import { NextRequest } from "next/server";
import {
  isAllowedSabrTarget,
  forwardableHeaders,
  passthroughResponseHeaders,
} from "@/lib/liner-proxy";
import { maintenanceGate } from "@/lib/maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// SABR transfers are long-lived but the client watchdog (30s idle) governs
// them; this only bounds a pathologically stalled upstream connection.
const UPSTREAM_TIMEOUT_MS = 600_000;

// browser-forbidden header we accept from the app and remap upstream
// (tvFetch marks every SABR request with the TV User-Agent this way)
const UA_OVERRIDE = "x-liner-user-agent";

function decodeTarget(request: NextRequest): URL | null {
  const raw = request.nextUrl.searchParams.get("u");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  const target = decodeTarget(request);
  if (!target || !isAllowedSabrTarget(target)) {
    return Response.json({ error: "Disallowed SABR target" }, { status: 400 });
  }

  const headers = forwardableHeaders(request);
  headers.set("host", target.host);
  headers.delete("referer");

  const userAgentOverride = headers.get(UA_OVERRIDE);
  if (userAgentOverride) {
    headers.delete(UA_OVERRIDE);
    headers.set("user-agent", userAgentOverride);
    // device-style client (TV SABR) must not expose web origin headers
    headers.delete("origin");
  }
  // SabrStream asks for identity encoding; undici would re-add compression
  // and transparently decompress, but identity keeps the stream 1:1
  headers.set("accept-encoding", "identity");

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      method: request.method,
      headers,
      body,
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "upstream unreachable";
    return Response.json({ error: "SABR upstream failed", message }, { status: 502 });
  }

  if (upstream.body === null) {
    return new Response(null, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: passthroughResponseHeaders(upstream),
    });
  }

  // stream pass-through: chunk timing is the contract with SabrStream
  const outHeaders = passthroughResponseHeaders(upstream);
  outHeaders.delete("content-length");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-headers": "content-type, x-liner-user-agent",
      "access-control-allow-methods": "POST, OPTIONS",
    },
  });
}
