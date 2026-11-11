import { NextRequest, NextResponse } from "next/server";
import { buildDbMirrorSnapshot, ensureDbReady } from "@/lib/db";
import { checkDbMirrorKey } from "@/lib/dbMirrorGate";

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
 * AUTH + key transports: see src/lib/dbMirrorGate.ts (shared with the
 * restore endpoint). Intentionally NOT gated by the maintenance wall: deploys
 * often happen during maintenance, and the round-trip must keep working then.
 */
export async function GET(req: NextRequest) {
  const gate = checkDbMirrorKey(req);
  if (!gate.ok) {
    if (gate.diagnostic) console.warn(gate.diagnostic);
    return NextResponse.json(gate.body, { status: gate.status });
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
