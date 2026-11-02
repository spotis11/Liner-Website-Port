// Liner web port: generic text/JSON upstream proxy.
// Covers everything the desktop renderer fetched directly thanks to
// Electron's open-CORS interceptor: SoundCloud clientId discovery (HTML + app
// scripts), YouTube TV oauth device flow, visitor data bootstrap, Deezer /
// Apple Music / Spotify playlist imports, Genius fallbacks, GitHub releases.
//
// Usage: /api/fetch?u=<urlencoded upstream url>  (any method, body forwarded)

import { NextRequest } from "next/server";
import { isAllowedFetchHost, forwardableHeaders, passthroughResponseHeaders } from "@/lib/liner-proxy";
import { maintenanceGate } from "@/lib/maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPSTREAM_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;

// browser-forbidden header we accept from the app and remap upstream
// (mirrors electron/cors.ts and the /api/yt route behaviour — without it
// www.youtube.com/tv serves a script-less shell page and TV sign-in dies)
const UA_OVERRIDE = "x-liner-user-agent";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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

async function proxy(request: NextRequest): Promise<Response> {
  const target = decodeTarget(request);
  if (!target || !isAllowedFetchHost(target.hostname)) {
    return Response.json({ error: "Disallowed fetch host" }, { status: 400 });
  }

  const headers = forwardableHeaders(request);
  headers.set("host", target.host);

  const userAgentOverride = headers.get(UA_OVERRIDE);
  if (userAgentOverride) {
    headers.delete(UA_OVERRIDE);
    headers.set("user-agent", userAgentOverride);
  } else if (!headers.has("user-agent")) {
    headers.set("user-agent", DEFAULT_USER_AGENT);
  }

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
  }

  const doFetch = (): Promise<Response> =>
    fetch(target.toString(), {
      method: request.method,
      headers,
      body,
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

  let upstream: Response;
  try {
    upstream = await doFetch();
  } catch (firstError) {
    // undici keep-alive sockets occasionally go stale after big transfers
    // ("fetch failed"). Safe methods retry unconditionally. Google OAuth
    // endpoints retry too: a device/code POST that never landed just leaves
    // an orphan code that expires unused, and the token endpoint is a poll
    // loop by definition (repeats never consume the grant). Other POSTs
    // (Liner API mutations) stay single-shot.
    const oauthEndpoint = /\/o\/oauth2\/(device\/code|token)$/.test(target.pathname);
    const retryable =
      request.method === "GET" ||
      request.method === "HEAD" ||
      (request.method === "POST" && oauthEndpoint);
    if (!retryable) {
      const message =
        firstError instanceof Error ? firstError.message : "upstream unreachable";
      return Response.json({ error: "Upstream request failed", message }, { status: 502 });
    }
    try {
      upstream = await doFetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : "upstream unreachable";
      return Response.json({ error: "Upstream request failed", message }, { status: 502 });
    }
  }

  if (request.method === "HEAD" || upstream.body === null) {
    return new Response(null, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: passthroughResponseHeaders(upstream),
    });
  }

  const buffer = await upstream.arrayBuffer().catch(() => new ArrayBuffer(0));
  if (buffer.byteLength > MAX_BUFFER_BYTES) {
    return Response.json({ error: "Upstream payload too large to proxy" }, { status: 502 });
  }

  const outHeaders = passthroughResponseHeaders(upstream);
  outHeaders.delete("content-length");
  outHeaders.set("content-length", String(buffer.byteLength));

  return new Response(buffer, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

export async function GET(request: NextRequest) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  return proxy(request);
}

export async function POST(request: NextRequest) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  return proxy(request);
}

export async function PUT(request: NextRequest) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  return proxy(request);
}

export async function PATCH(request: NextRequest) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  return proxy(request);
}

export async function DELETE(request: NextRequest) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  return proxy(request);
}

export async function HEAD(request: NextRequest) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  return proxy(request);
}
