// Liner web port: SoundCloud API proxy.
// Forwards /api/sc/<path> to https://api-v2.soundcloud.com/<path> preserving
// query (incl. client_id) and headers. The renderer reaches this via the
// global fetch interceptor (webProxy.ts) — the desktop build relied on
// Electron to open CORS on api-v2.soundcloud.com responses.

import { NextRequest } from "next/server";
import { SC_UPSTREAM, forwardableHeaders, passthroughResponseHeaders } from "@/lib/liner-proxy";
import { maintenanceGate } from "@/lib/maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPSTREAM_TIMEOUT_MS = 30_000;

function buildUpstreamUrl(request: NextRequest, relativePath: string): string {
  const search = request.nextUrl.search || "";
  return `${SC_UPSTREAM}/${relativePath}${search}`;
}

async function proxy(request: NextRequest): Promise<Response> {
  const { pathname } = request.nextUrl;
  const prefix = "/api/sc/";
  const relative = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
  if (!relative) {
    return Response.json({ error: "Missing SoundCloud endpoint" }, { status: 400 });
  }

  const headers = forwardableHeaders(request);
  headers.delete("origin");
  headers.delete("referer");

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(buildUpstreamUrl(request, relative), {
      method: request.method,
      headers,
      body,
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "upstream unreachable";
    return Response.json({ error: "SoundCloud upstream failed", message }, { status: 502 });
  }

  if (request.method === "HEAD" || upstream.body === null) {
    return new Response(null, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: passthroughResponseHeaders(upstream),
    });
  }

  const buffer = await upstream.arrayBuffer().catch(() => new ArrayBuffer(0));
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

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
