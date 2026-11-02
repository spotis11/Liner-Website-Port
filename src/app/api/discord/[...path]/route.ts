// Liner web port: Discord REST relay for the web Discord RPC.
//
// Browsers cannot call Discord's REST with bot-scheme auth: the Discord edge
// rejects `Authorization: Bot` requests that do not carry the documented
// `DiscordBot (url, version)` User-Agent, and browsers cannot override
// User-Agent. User-scheme requests additionally want X-Super-Properties.
// The SPA therefore relays the handful of REST calls the RPC needs through
// this route. The token is never stored server-side — it arrives per request
// via the `x-liner-token` header and is forwarded as-is.
//
// Allowlist: only /users/@me and /applications/* paths are forwarded.

import { NextRequest } from "next/server";
import {
  DISCORD_API,
  UPSTREAM_TIMEOUT_MS,
  discordAuthHeaders,
  DEV_PORTAL_CONTEXT_PROPERTIES,
} from "@/lib/discord-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

function isAllowedPath(path: string): boolean {
  return path === "users/@me" || path.startsWith("applications/");
}

async function relayOnce(
  scheme: "bot" | "user",
  token: string,
  method: string,
  upstreamUrl: string,
  bodyText: string | undefined,
): Promise<Response> {
  const headers = discordAuthHeaders(scheme, token);
  if (bodyText !== undefined) headers["Content-Type"] = "application/json";
  // Creating the per-user artwork application is rejected without the
  // dev-portal context header — and without that application no cover or
  // artist image can ever reach the presence.
  if (scheme === "user" && method === "POST" && upstreamUrl === `${DISCORD_API}/applications`) {
    headers["X-Context-Properties"] = DEV_PORTAL_CONTEXT_PROPERTIES;
  }
  return fetch(upstreamUrl, {
    method,
    headers,
    body: bodyText,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

async function relay(
  token: string,
  method: string,
  path: string,
  search: string,
  bodyText: string | undefined,
  schemeHint: "bot" | "user" | null,
): Promise<Response> {
  if (!isAllowedPath(path)) {
    return Response.json({ message: "Path not allowed" }, { status: 400 });
  }
  const upstreamUrl = `${DISCORD_API}/${path}${search}`;

  // Scheme preference can be provided by the SPA (learned on the first call);
  // otherwise bot is tried first and we transparently fall back to user auth.
  const order: Array<"bot" | "user"> =
    schemeHint === "user" ? ["user", "bot"] : ["bot", "user"];

  const started = Date.now();
  let result: { status: number; body: string; scheme: "bot" | "user" } | null = null;
  for (const scheme of order) {
    let res: Response;
    try {
      res = await relayOnce(scheme, token, method, upstreamUrl, bodyText);
    } catch {
      console.log(
        `[discord-relay] ${method} /${path} upstream-unreachable ${Date.now() - started}ms`,
      );
      return Response.json(
        { message: "Discord upstream unreachable" },
        { status: 502 },
      );
    }
    const text = await res.text();
    result = { status: res.status, body: text, scheme };
    if (res.status !== 401) break;
    // 401 under the wrong scheme — try the other one once
  }

  // Diagnostic trace only: method, path, resolved scheme and upstream status.
  // Never logs the token or body contents.
  console.log(
    `[discord-relay] ${method} /${path} ${result!.scheme}:${result!.status} ${Date.now() - started}ms`,
  );

  const response = new Response(result!.body, {
    status: result!.status,
    headers: { "Content-Type": "application/json" },
  });
  response.headers.set("x-liner-auth-scheme", result!.scheme);
  return response;
}

async function handle(
  request: NextRequest,
  pathSegments: string[] | undefined,
): Promise<Response> {
  const token = request.headers.get("x-liner-token");
  if (!token) {
    return Response.json({ message: "Missing token header" }, { status: 400 });
  }
  const path = (pathSegments ?? []).join("/");
  if (!path) {
    return Response.json({ message: "Missing path" }, { status: 400 });
  }
  const method = request.method.toUpperCase();
  let bodyText: string | undefined;
  if (method !== "GET" && method !== "DELETE" && method !== "HEAD") {
    bodyText = await request.text();
    if (bodyText && bodyText.length > MAX_BODY_BYTES) {
      return Response.json({ message: "Body too large" }, { status: 413 });
    }
  }
  const schemeHint =
    request.headers.get("x-liner-scheme") === "user"
      ? ("user" as const)
      : request.headers.get("x-liner-scheme") === "bot"
        ? ("bot" as const)
        : null;
  return relay(token, method, path, new URL(request.url).search, bodyText, schemeHint);
}

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  return handle(request, (await ctx.params).path);
}
export async function POST(request: NextRequest, ctx: Ctx) {
  return handle(request, (await ctx.params).path);
}
export async function PUT(request: NextRequest, ctx: Ctx) {
  return handle(request, (await ctx.params).path);
}
export async function DELETE(request: NextRequest, ctx: Ctx) {
  return handle(request, (await ctx.params).path);
}
