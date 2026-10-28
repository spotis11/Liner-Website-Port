// Liner web port: binary media proxy with Range support.
// Streams audio from googlevideo / sndcdn / presigned R2 URLs through the
// same origin so the crossOrigin="anonymous" <audio> element stays readable
// (the desktop build relied on Electron to strip CORS upstream).
//
// Usage: /api/media?u=<urlencoded upstream url>
// Range semantics are forwarded upstream; the (bounded) upstream slice is
// consumed server-side and replayed with identical 206/200 headers. Raw body
// pass-through truncates under the Next.js dev server, so buffering is
// deliberate — slices are typically <= a few MB.

import { NextRequest } from "next/server";
import { isAllowedMediaHost, forwardableHeaders, passthroughResponseHeaders } from "@/lib/liner-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPSTREAM_TIMEOUT_MS = 120_000;
const MAX_BUFFER_BYTES = 64 * 1024 * 1024; // full-track downloads stay well below this

// browser-forbidden header we accept from the app and remap upstream.
// googlevideo URLs are bound to the User-Agent of the player request that
// minted them (TV SABR sends x-liner-user-agent via its tvFetch) — without
// this mapping signed-in TV playback gets 403s.
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

async function proxy(request: NextRequest): Promise<Response> {
  const target = decodeTarget(request);
  if (!target || !isAllowedMediaHost(target.hostname)) {
    return Response.json({ error: "Disallowed media host" }, { status: 400 });
  }

  const headers = forwardableHeaders(request);
  headers.set("host", target.host);
  // some CDNs sign URLs per-referer; keep ours out of the request
  headers.delete("referer");

  const userAgentOverride = headers.get(UA_OVERRIDE);
  if (userAgentOverride) {
    headers.delete(UA_OVERRIDE);
    headers.set("user-agent", userAgentOverride);
  }

  // POST/PUT bodies are forwarded too (e.g. UMP protobuf requests that were
  // rewritten here before the SABR rule existed) — without this the route
  // answers 405 to anything but GET/HEAD and the player retry-loops.
  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const raw = await request.arrayBuffer().catch(() => undefined);
    if (raw && raw.byteLength > 0) body = raw;
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
    return Response.json({ error: "Media upstream failed", message }, { status: 502 });
  }

  if (request.method === "HEAD" || upstream.body === null) {
    const headHeaders = passthroughResponseHeaders(upstream);
    return new Response(null, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: headHeaders,
    });
  }

  const buffer = await upstream.arrayBuffer().catch(() => new ArrayBuffer(0));
  if (buffer.byteLength > MAX_BUFFER_BYTES) {
    return Response.json({ error: "Media payload too large to proxy" }, { status: 502 });
  }

  const outHeaders = passthroughResponseHeaders(upstream);
  outHeaders.delete("content-length");
  outHeaders.set("content-length", String(buffer.byteLength));
  if (!outHeaders.has("accept-ranges")) {
    outHeaders.set("accept-ranges", "bytes");
  }

  return new Response(buffer, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

export async function GET(request: NextRequest) {
  return proxy(request);
}

export async function HEAD(request: NextRequest) {
  return proxy(request);
}

export async function POST(request: NextRequest) {
  return proxy(request);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "accept-ranges": "bytes",
      "access-control-allow-headers": "range, content-type, x-liner-user-agent",
      "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
    },
  });
}
