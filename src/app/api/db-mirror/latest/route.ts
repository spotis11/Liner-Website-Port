import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { buildDbMirrorSnapshot, ensureDbReady } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/db-mirror/latest — deploy-time database export.
 *
 * WHY THIS EXISTS: every platform Deploy recreates the FC container, and
 * the container's filesystem (including the live SQLite file AND the runtime
 * db-mirror.json written next to it) dies with it. The package's seed mirror
 * used to be built from the WORKSPACE database — which has never seen the
 * accounts users created on production — so every deploy signed everyone out
 * and wiped their accounts/playlists. The fix is a round-trip: the build
 * script (which runs in the workspace) fetches THIS endpoint and packages the
 * LIVE production state as the seed mirror, so a fresh container restores
 * exactly what production had at build time (see restoreDbFromMirror in
 * src/lib/db.ts and .zscripts/database-runtime-build.sh).
 *
 * AUTH: the response contains every account row (password hashes, emails,
 * session token hashes), so it is locked behind DB_MIRROR_EXPORT_KEY — a
 * random secret shared only between this server's env and the workspace
 * build (both read the same gitignored .env; the key never enters git).
 * Unconfigured server → 503 (build falls back to the workspace seed).
 * Timing-safe comparison; no CORS headers, so browsers can't read it.
 *
 * KEY TRANSPORTS: the platform's HTTP gateway strips non-standard request
 * headers (it already rewrites Host and intercepts HEAD), which silently
 * emptied `x-db-mirror-key` and made every deploy-time export 403 — the
 * build then fell back to the stale workspace mirror and users lost their
 * accounts all over again (v1.14.2). The key is therefore accepted through
 * every transport a gateway must respect, in order:
 *   1. `x-db-mirror-key: <key>`      (original, works server-to-server locally)
 *   2. `authorization: Bearer <key>` (core HTTP — no gateway drops this)
 *   3. `?exportKey=<key>`            (last-resort fallback; HTTPS-only secret,
 *                                     kept out of build logs)
 *
 * Intentionally NOT gated by the maintenance wall: deploys often happen
 * during maintenance, and the round-trip must keep working then.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.DB_MIRROR_EXPORT_KEY?.trim();
  if (!expected) {
    return NextResponse.json(
      { error: "db mirror export is not configured on this server" },
      { status: 503 },
    );
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
    console.warn(
      `[db-mirror] export request rejected (header=${headerKey ? `${headerKey.length} chars` : "absent"}, bearer=${bearerKey ? `${bearerKey.length} chars` : "absent"}, param=${paramKey ? `${paramKey.length} chars` : "absent"}, expected=${expected.length} chars)`,
    );
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await ensureDbReady();
  const snapshot = await buildDbMirrorSnapshot();
  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(snapshot.tables)) {
    counts[name] = rows.length;
  }
  console.log(
    `[db-mirror] export served (savedAt ${snapshot.savedAt}, accounts ${counts.account}, sessions ${counts.session})`,
  );

  return NextResponse.json(
    { ...snapshot, counts },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
