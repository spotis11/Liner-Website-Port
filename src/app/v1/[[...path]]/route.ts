import { NextRequest, NextResponse } from "next/server";
import { maintenanceGate } from "@/lib/maintenance";
import { verifyAccessToken } from "@/lib/websiteAuth";
import { db } from "@/lib/db";
import { collectLyricsCandidates, type LyricsHint } from "@/lib/lyricsProviders";
import {
  applyUpstreamProfilePatch,
  overlayUpstreamProfile,
  UpstreamProfileError,
} from "@/lib/upstreamProfileOverlay";
import { signUpstreamRequest } from "@/lib/upstreamSigner";
import {
  getServiceLinerAccessToken,
  refreshServiceLinerToken,
} from "@/lib/linerUpstreamService";
import {
  isUpstreamTrackId,
  resolveUpstreamTrackId,
} from "@/lib/lyricsIdResolver";

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
 *    valid end to end.
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

// The upstream for ALL forwarded /v1 calls: the STABLE api (api.tryliner.fun)
// — real Liner accounts and their tokens live there, and the relay's own
// service identity logs in there (linerUpstreamService). The 2026-11-24 beta
// era pointed this at staging.tryliner.fun because the beta renderer had it
// baked as its API base; that broke upstream login/refresh for every real
// account (401 / 403 BETA_REQUIRED — staging only knows beta-gated accounts).
// The beta renderer is retired from the site now, the fan app rides the
// stable host again. The beta-only surfaces the relay serves locally
// (charts/*, me/mixes) keep their own hops and local fallbacks.
// Overridable via LINER_UPSTREAM_BASE for rollbacks.
const UPSTREAM = process.env.LINER_UPSTREAM_BASE || "https://api.tryliner.fun";
const FORWARD_TIMEOUT_MS = 20_000;
// Home-surface catalog forwards must answer BEFORE the running.sh edge's
// ~20s cut: the upstream's 30d/all popular-albums windows routinely take
// longer than that, and the client then sees the edge's 503/502 instead of
// our empty-state fallback. Bail to the fallback at 8s — well under the edge.
const HOME_CATALOG_TIMEOUT_MS = 8_000;

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

/**
 * PATCH /v1/users/me for UPSTREAM sessions — stored locally, answered
 * locally. The upstream API has NO profile-edit route at all (every shape
 * 404s: "Route PATCH:/v1/users/me not found" — verified live 2026-11-14 with
 * a real upstream session), so the browser's validly-signed PATCH can never
 * succeed there. Instead: prove the token against the upstream with a
 * server-signed GET /v1/me (the client claims are never trusted for the
 * overlay key), store the patch in UpstreamProfile, answer with the merged
 * user. Website sessions (at_ tokens) never reach this — they dispatch to
 * websiteProfilePATCH below.
 */
async function upstreamProfilePATCH(
  req: NextRequest,
  bodyBytes: ArrayBuffer | null,
): Promise<Response> {
  let patch: Record<string, unknown> | null = null;
  if (bodyBytes && bodyBytes.byteLength > 0) {
    try {
      patch = JSON.parse(new TextDecoder().decode(bodyBytes)) as Record<string, unknown>;
    } catch {}
  }
  if (!patch || typeof patch !== "object") {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  let upstreamRes: Response;
  try {
    // upstreamHeaders returns a Headers instance — spread would empty it;
    // overlay the fresh signature headers on the instance itself
    const hopHeaders = upstreamHeaders(req);
    const signature = signUpstreamRequest("GET", "/v1/me");
    hopHeaders.set("x-liner-signature", signature["x-liner-signature"]);
    hopHeaders.set("x-liner-timestamp", signature["x-liner-timestamp"]);
    hopHeaders.set("x-liner-nonce", signature["x-liner-nonce"]);
    upstreamRes = await fetch(`${UPSTREAM}/v1/me`, {
      method: "GET",
      headers: hopHeaders,
      redirect: "manual",
    });
  } catch {
    return NextResponse.json(
      { error: "Upstream unreachable.", code: "UPSTREAM_UNREACHABLE" },
      { status: 503 },
    );
  }
  if (!upstreamRes.ok) {
    // relay the upstream's auth answer (401/403) untouched
    const buf = await upstreamRes.arrayBuffer();
    console.warn(
      `[v1/users/me PATCH] validation hop status=${upstreamRes.status} ct=${upstreamRes.headers.get("content-type")} body=${new TextDecoder().decode(buf.slice(0, 200))}`,
    );
    const res = new NextResponse(buf, { status: upstreamRes.status });
    const ct = upstreamRes.headers.get("content-type");
    if (ct) res.headers.set("content-type", ct);
    return res;
  }
  let user: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(await upstreamRes.arrayBuffer()));
    user = (parsed?.user ?? parsed) as Record<string, unknown> | null;
  } catch {
    user = null;
  }
  if (!user || typeof user !== "object") {
    return NextResponse.json(
      { error: "Upstream user payload incomplete.", code: "UPSTREAM_SHAPE" },
      { status: 502 },
    );
  }
  try {
    const merged = await applyUpstreamProfilePatch(user, patch);
    return NextResponse.json(merged);
  } catch (error) {
    if (error instanceof UpstreamProfileError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[v1/users/me PATCH]", error);
    return NextResponse.json({ error: "Profile update failed." }, { status: 500 });
  }
}

async function forward(
  req: NextRequest,
  path: string,
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

/**
 * One authed GET to the upstream catalog — 200-or-null, HTML-guarded, same
 * contract as forwardAnonymous but with caller-owned headers (bearer set by
 * the caller: a real upstream session token or the relay's service identity).
 */
async function upstreamCatalogGet(
  pathWithSearch: string,
  headers: Headers,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    const upstream = await fetch(`${UPSTREAM}${pathWithSearch}`, {
      method: "GET",
      headers,
      signal: controller.signal,
      redirect: "manual",
    });
    const contentType = upstream.headers.get("content-type");
    if (!upstream.ok || contentType?.includes("text/html")) return null;
    const body = await upstream.arrayBuffer();
    const res = new NextResponse(body, {
      status: upstream.status,
      statusText: upstream.statusText,
    });
    if (contentType) res.headers.set("content-type", contentType);
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Race a home-catalog upstream attempt against the edge-safe deadline. */
async function withTimeout<T>(promise: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), HOME_CATALOG_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Home-surface catalog forward — explore/popular/albums + explore/most-saved.
 * The upstream serves these ONLY to signed-in Liner accounts: the anonymous
 * forward comes back non-200 (verified live 2026-11-16: explore/popular
 * tracks answer anonymously, the albums/most-saved routes don't — the route
 * exists, a probe through the default branch 308-normalizes to it while the
 * sibling guesses 404). An empty answer pushed the client into its
 * geo-personalized innertube fallback, whose CN-egress session surfaced
 * CHINESE albums ("Top Albums" in Mandarin) instead of the real Liner home.
 *
 * Order: a real upstream bearer first (an upstream session gets its own
 * personalized answer — exactly what the real app shows that account), then
 * the anonymous forward (works if the upstream ever opens the routes up),
 * then the relay's own service identity (guests + website sessions — the
 * same session the lyrics bridge rides, with one 401 re-mint retry), then
 * the local empty fallback.
 */
async function forwardHomeCatalog(
  req: NextRequest,
  pathWithSearch: string,
  bodyBytes: ArrayBuffer | null,
  fallback: () => NextResponse,
): Promise<NextResponse> {
  try {
    const bearer =
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
    if (bearer && !isWebsiteToken(bearer)) {
      const headers = upstreamHeaders(req);
      headers.set("authorization", `Bearer ${bearer}`);
      const res = await withTimeout(upstreamCatalogGet(pathWithSearch, headers));
      if (res) return res;
    }
    const anon = await withTimeout(
      forwardAnonymous(req, pathWithSearch, bodyBytes),
    );
    if (anon && anon.status === 200) return anon;
    const serviceToken = await getServiceLinerAccessToken();
    if (serviceToken) {
      const headers = upstreamHeaders(req);
      headers.set("authorization", `Bearer ${serviceToken}`);
      let res = await withTimeout(upstreamCatalogGet(pathWithSearch, headers));
      if (!res) {
        // cached service bearer may have expired upstream-side — re-mint once
        const fresh = await refreshServiceLinerToken();
        if (fresh) {
          headers.set("authorization", `Bearer ${fresh}`);
          res = await withTimeout(upstreamCatalogGet(pathWithSearch, headers));
        }
      }
      if (res) return res;
    }
    return fallback();
  } catch {
    // home surfaces must never error the browser: any unexpected failure
    // (boot-window DB races, helper throws) degrades to the empty catalog —
    // the client falls through to its own providers instead of a 500
    return fallback();
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
  // Polaris Mono (the real Liner word-level provider) serves ONLY signed-in
  // Liner accounts: bearer-less calls get 401 "Sign in to Liner to see
  // lyrics." (verified live 2026-11-14). Real upstream bearers pass through
  // as before; website sessions and signed-out visitors ride the relay's OWN
  // upstream identity (LINER_SERVICE_* — see linerUpstreamService) so every
  // session gets the real Liner lyrics. When no identity is available or the
  // upstream still refuses, this SAME response degrades to the local lrclib
  // pool — the client never needs a second hop.
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const upstreamBearer = bearer && !isWebsiteToken(bearer) ? bearer : null;
  const serviceToken = upstreamBearer ? null : await getServiceLinerAccessToken();
  if (!upstreamBearer && !serviceToken) {
    return lyricsStream(new URL(req.url));
  }

  // LOCAL-id resolution (2026-11-15): pre-loaded feed tracks and local search
  // hits carry audius/itunes/local ids the upstream rejects outright (400
  // VALIDATION_ERROR — its track ids are 11-char YouTube videoIds or "sc:…").
  // Before touching the upstream, swap a local id for the resolved YouTube id
  // (same title/artist hints the SPA already sends). Verified live: audius id
  // → 400 → lrclib line_level; resolved id → Polaris Mono word_level plus
  // Unison/Wordly/Liner Experimental/Liner options.
  const url = new URL(req.url);
  const title = (url.searchParams.get("title") ?? "").trim();
  const artist = (url.searchParams.get("artist") ?? "").trim();
  let resolvedRoute = route;
  const idMatch = route.match(/^tracks\/([^/]+)\/lyrics$/);
  if (idMatch) {
    const trackId = decodeURIComponent(idMatch[1]);
    if (!isUpstreamTrackId(trackId)) {
      if (!title || !artist) {
        // no hints to resolve with — the upstream call would just 400
        return lyricsStream(url);
      }
      const resolved = await resolveUpstreamTrackId(title, artist);
      if (!resolved) {
        // nothing plausible on YT Music — local pool straight away
        return lyricsStream(url);
      }
      resolvedRoute = `tracks/${encodeURIComponent(resolved)}/lyrics`;
    }
  }

  const headers = upstreamHeaders(req);
  headers.set("authorization", `Bearer ${upstreamBearer ?? serviceToken}`);
  try {
    let upstream = await fetch(`${UPSTREAM}/v1/${resolvedRoute}${search}`, {
      method: "GET",
      headers,
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(60_000)]),
      redirect: "manual",
    });
    if (serviceToken && (upstream.status === 401 || upstream.status === 403)) {
      // cached service bearer expired upstream-side — re-mint once and retry
      const fresh = await refreshServiceLinerToken();
      if (fresh) {
        headers.set("authorization", `Bearer ${fresh}`);
        upstream = await fetch(`${UPSTREAM}/v1/${resolvedRoute}${search}`, {
          method: "GET",
          headers,
          signal: AbortSignal.any([req.signal, AbortSignal.timeout(60_000)]),
          redirect: "manual",
        });
      }
    }
    const contentType = upstream.headers.get("content-type") ?? "";
    if (contentType.includes("text/html") || !upstream.ok) {
      // Cloudflare challenge or upstream miss — degrade to the local pool.
      // A 400/404 here can also mean the RESOLVED id has no lyrics upstream
      // (rare, but a different YT upload of the song may have them) — one
      // re-resolve is not worth the latency; lrclib is the correct answer.
      return lyricsStream(new URL(req.url));
    }
    const resHeaders = new Headers();
    if (contentType) resHeaders.set("content-type", contentType);
    resHeaders.set("cache-control", "no-cache, no-transform");
    for (const name of ["date", "x-request-id", "retry-after"] as const) {
      const value = upstream.headers.get(name);
      if (value) resHeaders.set(name, value);
    }
    // Buffer the upstream SSE so we can tell whether it actually carried
    // lyrics. The upstream returns 200 even when every provider is not_found
    // or errored — for a niche track its source-fetchers (Polaris Mono, Liner
    // Atlas, Genius) report "source request failed" and the stream ends with
    // done: not_found. A raw passthrough forwards those errors to the player
    // and stops there. So when no candidate was found, fall back to this
    // server's own lrclib pool (it searches by title/artist, not YouTube id,
    // and may surface line-level lyrics the upstream's id-keyed LRCLIB lookup
    // missed); only when that is empty does the player see a clean "no lyrics
    // found" — never the noisy upstream source-fetch errors.
    const bodyText = await upstream.text();
    const hasCandidate = /"status"\s*:\s*"found"/.test(bodyText);
    if (!hasCandidate) {
      return lyricsStream(new URL(req.url));
    }
    return new Response(bodyText, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: resHeaders,
    });
  } catch {
    return lyricsStream(new URL(req.url));
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

  // ---- 0.2.20 beta aliases -------------------------------------------------
  // The beta renderer renamed/moved several surfaces. The website backend
  // answers the old shapes, so the beta's routes are mapped onto them:
  //   likes:             me/library/tracks[/:trackId] -> me/likes[/:trackId]
  //   daily mixes:       me/recommendations/daily-mixes -> me/mixes
  //   history events:    me/playback/events -> me/history (POST)
  //   profile:           users/me (PATCH) -> me/profile (GET/PATCH) + /layout
  //   playlist edits:    me/playlists/:id/... -> playlists/:id/...
  //   saved collections: me/library/:kind -> me/saved/:kind
  if (route === "me/likes" && method === "GET") {
    return websiteLikedGET(q(`/api/library/tracks${search}`));
  }
  const betaLikeMatch = route.match(/^me\/likes\/([^/]+)$/);
  if (betaLikeMatch) {
    if (method === "PUT") return websiteLikedPUT(q("/api/library/tracks"));
    if (method === "DELETE") {
      return websiteLikedDELETE(
        q(`/api/library/tracks?trackId=${encodeURIComponent(betaLikeMatch[1])}`),
      );
    }
  }
  if (route === "me/mixes" && method === "GET") {
    return dailyMixes(req);
  }
  if (route === "me/history" && method === "POST") {
    return new NextResponse(null, { status: 204 });
  }
  if (route === "me/profile" && method === "GET") {
    return websiteMeGET(q("/api/auth/me"));
  }
  if (route === "me/profile" && method === "PATCH") {
    return websiteProfilePATCH(q("/api/auth/profile"));
  }
  if (route === "me/profile/layout" && method === "PUT") {
    // the website backend has no module layout store — accept and ack so the
    // beta's profile editor does not hard-fail for website sessions
    return new NextResponse(null, { status: 204 });
  }
  const betaPlaylistMatch = route.match(
    /^playlists\/([^/]+)(\/(items)(\/([^/]+))?(\/move)?)?$/,
  );
  if (betaPlaylistMatch) {
    const id = betaPlaylistMatch[1];
    const kind = betaPlaylistMatch[3];
    const sub = betaPlaylistMatch[5];
    const isMove = Boolean(betaPlaylistMatch[6]);
    const dynId = { params: Promise.resolve({ id }) } as never;
    if (!kind) {
      if (method === "GET") {
        // the beta reads BOTH own website playlists and upstream public
        // playlists through this route: answer website rows first, fall
        // through to the upstream (anonymous) for ids this site doesn't know
        const local = await websitePlaylistGET(
          q(`/api/library/playlists/${id}${search}`),
          dynId,
        );
        if (local.status !== 404) return local;
        return forwardAnonymous(req, `/v1/playlists/${id}${search}`, bodyBytes);
      }
      if (method === "PATCH") {
        return websitePlaylistPATCH(q("/api/library/playlists"), dynId);
      }
      if (method === "DELETE") {
        return websitePlaylistDELETE(q("/api/library/playlists"), dynId);
      }
    }
    if (kind === "items" && !sub && method === "POST") {
      return websitePlaylistTracksPOST(q("/api/library/playlists"), dynId);
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
  if (route.startsWith("me/saved/")) {
    // saved albums/artists/playlists collections — accepted, stored empty
    if (method === "GET") return NextResponse.json({ items: [] });
    if (method === "PUT" || method === "DELETE") {
      return new NextResponse(null, { status: 204 });
    }
  }
  // ---- end 0.2.20 beta aliases --------------------------------------------

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
  // ---- 0.2.20 beta home charts -------------------------------------------
  // The beta home feed reads /v1/charts/* (staging-only routes). Same policy
  // as explore/popular: upstream first (the relay's service identity or the
  // caller's real bearer), graceful local fallback when the upstream is
  // unreachable from this egress (running.sh gets Cloudflare-challenged).
  const betaChartMatch = route.match(/^charts\/([a-z]+)$/);
  if (betaChartMatch && method === "GET") {
    const kind = betaChartMatch[1];
    const localFallback = () => {
      if (kind === "tracks") {
        const raw = url.searchParams.get("window") ?? "12h";
        const window = ["12h", "24h", "7d", "30d", "all"].includes(raw)
          ? raw
          : "12h";
        return NextResponse.json({ window, items: [] });
      }
      return NextResponse.json({ type: url.searchParams.get("type") ?? "all", items: [] });
    };
    // the staging edge challenges forwarded browser header sets (x-client-
    // version etc.) even with the desktop UA — a minimal clean fetch (pinned
    // desktop UA only) passes. Website tokens mean nothing upstream, so the
    // bearer is dropped regardless.
    try {
      const clean = await fetch(`${UPSTREAM}/v1/${route}${url.search}`, {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": UPSTREAM_CLIENT_UA,
        },
        // cold-container staging handshakes can outrun the 8s catalog
        // deadline — the beta home feed runs this hop FIRST after login, so
        // give it 15s (the running.sh edge cuts the request at ~20s)
        signal: AbortSignal.timeout(15_000),
        redirect: "manual",
      });
      const contentType = clean.headers.get("content-type") ?? "";
      if (clean.ok && contentType.includes("application/json")) {
        const body = await clean.arrayBuffer();
        const res = new NextResponse(body, { status: clean.status });
        res.headers.set("content-type", contentType);
        return res;
      }
    } catch {
      /* fall through to the local answer */
    }
    return localFallback();
  }
  if (route === "explore/popular" && method === "GET") {
    // REAL Liner trending: the upstream exposes explore/popular anonymously
    // (verified live 2026-11-14) and its data IS what the real Liner home
    // shows. The local community answer (this site's own accounts' plays) is
    // empty for fresh visitors or skews toward a single listener, which used
    // to push the client into its YouTube Music (innertube) fallback whose
    // geo-personalized feed surfaced unrelated regional tracks. Upstream
    // first, this site's own community data only as the degraded fallback.
    const upstreamRes = await forwardAnonymous(req, `/v1/${route}${url.search}`, bodyBytes);
    if (upstreamRes.status === 200) return upstreamRes;
    const raw = url.searchParams.get("window") ?? "all";
    const window = ["12h", "24h", "7d", "30d", "all"].includes(raw)
      ? raw
      : "all";
    try {
      return await popularTracks(window);
    } catch {
      // local aggregation hit an unexpected failure (e.g. boot-window DDL
      // race) — degrade to the empty answer instead of a 500
      return NextResponse.json({
        window,
        generatedAt: new Date().toISOString(),
        items: [],
      });
    }
  }
  if (route === "explore/popular/albums" && method === "GET") {
    // same policy as explore/popular: upstream is the source of truth for
    // the home surfaces — but these routes are auth-gated upstream, so the
    // forward rides a real bearer / the service identity when anonymous
    // fails (see forwardHomeCatalog — the CN-innertube-fallback fix)
    return forwardHomeCatalog(req, `/v1/${route}${url.search}`, bodyBytes, () =>
      NextResponse.json({
        window: url.searchParams.get("window") ?? "7d",
        items: [],
      }),
    );
  }
  if (route === "explore/most-saved" && method === "GET") {
    return forwardHomeCatalog(req, `/v1/${route}${url.search}`, bodyBytes, () =>
      NextResponse.json({
        type: url.searchParams.get("type") ?? "all",
        items: [],
      }),
    );
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

  // 2026-11-24: the 0.2.20 beta renderer (now at /liner-beta) expects these
  // upstream social surfaces; with the staging edge gating us they 503'd and
  // broke panels — sane empty shapes keep the UI alive
  if (route === "me/hidden" && method === "GET") {
    return NextResponse.json({ items: [] });
  }
  if (route === "me/connections" && method === "GET") {
    return NextResponse.json({ items: [] });
  }
  if (route === "me/sessions" && method === "GET") {
    return NextResponse.json({ items: [] });
  }
  if (route === "me/friends" && method === "GET") {
    return NextResponse.json({ items: [] });
  }
  if (route === "me/friend-requests" && method === "GET") {
    return NextResponse.json({ items: [] });
  }
  if (route === "me/presence" && method === "GET") {
    return new NextResponse(null, { status: 204 });
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

/** Anonymous upstream GET parsed as JSON (null on any failure). */
async function upstreamAnonymousJson(
  req: NextRequest,
  path: string,
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    const upstream = await fetch(`${UPSTREAM}${path}`, {
      method: "GET",
      headers: anonymousHeaders(req),
      signal: controller.signal,
      redirect: "manual",
    });
    if (!upstream.ok) return null;
    const contentType = upstream.headers.get("content-type");
    if (!contentType?.includes("application/json")) return null;
    return JSON.parse(new TextDecoder().decode(await upstream.arrayBuffer()));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
  if (mixes.length === 0) {
    // Fresh visitor (no likes yet): build the mixes from the REAL Liner
    // trending pool (the same source the upstream explore/popular home
    // surface serves, which is what the Liner desktop home shows). Without
    // this the client fell back to its innertube YouTube Music feed, whose
    // geo-personalized picks surfaced unrelated regional tracks (v1.26.2
    // home-screen report: "listening right now is chinese songs"). Tracks
    // are clustered by primary artist like the liked-tracks builder above —
    // one trending fetch, so the four mixes stay diverse instead of four
    // near-identical windows of the same songs.
    const data = await upstreamAnonymousJson(
      req,
      "/v1/explore/popular?window=30d&limit=50",
    );
    const items = Array.isArray(data?.items) ? data.items : [];
    const seen = new Set<string>();
    const clusters = new Map<string, Record<string, unknown>[]>();
    for (const item of items) {
      const track = (item as Record<string, unknown>)?.track;
      if (!track || typeof track !== "object") continue;
      const record = track as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : null;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const artistList = Array.isArray(record.artists) ? record.artists : [];
      const primary =
        (artistList[0] as Record<string, unknown> | undefined)?.name ??
        (typeof record.artist === "string" ? record.artist : "Unknown artist");
      const artist = String(primary).trim() || "Unknown artist";
      const list = clusters.get(artist) ?? [];
      list.push(record);
      clusters.set(artist, list);
    }
    const ordered = [...clusters.entries()].sort(
      (a, b) => b[1].length - a[1].length,
    );
    for (const [artist, tracks] of ordered.slice(0, 4)) {
      mixes.push({
        id: `daily-mix-${mixes.length + 1}`,
        title: `Daily Mix ${mixes.length + 1}`,
        description: `Trending on Liner — more like ${artist}`,
        clusterArtists: [artist],
        trackCount: Math.min(tracks.length, 10),
        // raw upstream track JSON — the client normalizes it via toClientTrack
        tracks: tracks.slice(0, 10),
      });
    }
  }
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
      // website tokens mean nothing upstream, but the real Liner lyrics
      // ("polaris mono") still do: the relay swaps in its own Liner service
      // identity (see upstreamLyrics) and degrades to the local pool in the
      // same response when the upstream has nothing. v1.26: upstream-first
      // for website sessions too — the SPA only adds ?upstream=1 when it
      // holds a Liner bearer, but Polaris Mono should not depend on session
      // type (the real Liner serves it to every signed-in listener; guests
      // here ride the service identity). Local-id tracks are resolved to
      // their YouTube ids inside upstreamLyrics first.
      return upstreamLyrics(req, route, url.search);
    }
    return websiteDispatch(req, route, url.search, bodyBytes);
  }

  // UPSTREAM MODE — real Liner sessions relayed to api.tryliner.fun
  if (route.startsWith("tracks/") && route.endsWith("/lyrics")) {
    // v1.26: the lyrics route is now ALWAYS upstream-first (real bearer or
    // service identity, local ids resolved to YouTube ids first) — the
    // lrclib pool only as the in-response degrade. The old ?upstream=1 flag
    // is accepted but no longer gates anything, so the provider never
    // depends on which hop the client happens to take.
    return upstreamLyrics(req, route, url.search);
  }
  // profile editing for upstream sessions: the upstream has no profile-edit
  // route (every PATCH/PUT/POST shape on /v1/users/me 404s), so edits are
  // stored locally (UpstreamProfile) and GET /v1/me answers with the stored
  // profile merged on top of the upstream user. See upstreamProfileOverlay.
  if (route === "users/me" && req.method === "PATCH") {
    return upstreamProfilePATCH(req, bodyBytes);
  }
  if (route === "me" && req.method === "GET") {
    const res = await forward(req, `/v1/me${url.search}`, bodyBytes);
    if (res.status !== 200) return res;
    const bytes = await res.arrayBuffer();
    const merged = await overlayUpstreamProfile(bytes, res.headers.get("content-type"));
    return new NextResponse(merged, { status: 200, headers: res.headers });
  }
  if (route === "auth/challenge" && req.method === "POST") {
    // upstream's challenge decides whether its Turnstile widget is needed
    // for this login/register (risk-gated per egress IP). The SPA now opens
    // the verify page in a TOP-LEVEL popup when required — a Cloudflare
    // interstitial is solvable there (first-party context), and the widget
    // is domain-authorized on Liner's own origin. The token flows back over
    // postMessage (the desktop uses the same channel). Pass the challenge
    // through untouched so the SPA prompts exactly when upstream demands it.
    const res = await forward(req, `/v1/${route}${url.search}`, bodyBytes);
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
      },
    });
  }
  if (route === "auth/verify") {
    return passthrough(req, `/v1/${route}${url.search}`, bodyBytes);
  }
  const forwarded = await forward(
    req,
    `/v1/${route}${url.search}`,
    bodyBytes,
  );
  if (route.startsWith("auth/") && forwarded.status >= 400) {
    // why did upstream refuse an auth hop? (WAF page vs JSON error code —
    // the SPA's message depends on it)
    const clone = forwarded.clone();
    const text = (await clone.text().catch(() => "")) || "";
    console.warn(
      `[v1/${route}] upstream ${forwarded.status} ct=${forwarded.headers.get("content-type")} body=${text.slice(0, 300)}`,
    );
  }
  return forwarded;
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
