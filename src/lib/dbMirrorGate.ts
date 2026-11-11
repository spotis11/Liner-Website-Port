import crypto from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Shared auth gate for the deploy-time database mirror endpoints
 * (GET /api/db-mirror/latest, POST /api/db-mirror/restore).
 *
 * WHY: the responses expose / replace every account row (password hashes,
 * emails, session token hashes), so both routes are locked behind
 * DB_MIRROR_EXPORT_KEY — a random secret shared only between this server's
 * env and the workspace build (both read the same gitignored .env; the key
 * never enters git). Timing-safe comparison; no CORS headers, so browsers
 * can't read responses.
 *
 * KEY TRANSPORTS: the platform's HTTP gateway strips non-standard request
 * headers (it already rewrites Host and intercepts HEAD), which silently
 * emptied `x-db-mirror-key` and made every deploy-time export 403 — the
 * build then fell back to the stale workspace mirror and users lost their
 * accounts (v1.14.2). The key is therefore accepted through every transport
 * a gateway must respect, in order:
 *   1. `x-db-mirror-key: <key>`      (original, works server-to-server locally)
 *   2. `authorization: Bearer <key>` (core HTTP — no gateway drops this)
 *   3. `?exportKey=<key>`            (last-resort fallback; HTTPS-only secret,
 *                                     kept out of build logs)
 */
export type DbMirrorGateResult =
  | { ok: true; provided: string }
  | {
      ok: false;
      status: number;
      body: Record<string, unknown>;
      diagnostic?: string;
    };

export function checkDbMirrorKey(req: NextRequest): DbMirrorGateResult {
  const expected = process.env.DB_MIRROR_EXPORT_KEY?.trim();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      body: { error: "db mirror export is not configured on this server" },
    };
  }

  const headerKey = req.headers.get("x-db-mirror-key")?.trim() ?? "";
  const bearerKey =
    req.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim() ?? "";
  const paramKey = req.nextUrl.searchParams.get("exportKey")?.trim() ?? "";
  const provided = headerKey || bearerKey || paramKey;

  const ok =
    provided.length > 0 &&
    provided.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!ok) {
    // Diagnostics only — never log the key material itself.
    const diagnostic = `[db-mirror] request rejected (header=${headerKey ? `${headerKey.length} chars` : "absent"}, bearer=${bearerKey ? `${bearerKey.length} chars` : "absent"}, param=${paramKey ? `${paramKey.length} chars` : "absent"}, expected=${expected.length} chars)`;
    return { ok: false, status: 403, body: { error: "forbidden" }, diagnostic };
  }

  return { ok: true, provided };
}
