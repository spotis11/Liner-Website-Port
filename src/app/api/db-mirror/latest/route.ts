import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { buildDbMirrorSnapshot, ensureDbReady } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/db-mirror/latest — deploy-time database export.
 *
 * WHY THIS EXISTS: every platform Deploy can recreate the FC container, and
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

  const provided = req.headers.get("x-db-mirror-key")?.trim() ?? "";
  const ok =
    provided.length > 0 &&
    provided.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!ok) {
    console.warn("[db-mirror] export request rejected (bad key)");
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
