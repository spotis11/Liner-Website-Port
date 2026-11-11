import { NextRequest, NextResponse } from "next/server";
import { parseDbMirrorPayload, replaceDbFromMirrorObject } from "@/lib/db";
import { checkDbMirrorKey } from "@/lib/dbMirrorGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/db-mirror/restore — owner's live-state recovery tool.
 *
 * WHY THIS EXISTS: the deploy-time seed round-trip (see GET
 * /api/db-mirror/latest) protects production data going INTO a deploy, but
 * when a bad seed has already shipped (the historical bug: the build
 * silently fell back to the workspace mirror and wiped user accounts /
 * echoed E2E test accounts into production), there was no way to repair the
 * LIVE server short of another deploy. This endpoint replaces the running
 * server's mirrored-table state with a posted mirror — e.g. the last export
 * fetched from production, cleaned of junk — without a redeploy.
 *
 * AUTH: same DB_MIRROR_EXPORT_KEY gate as the export endpoint (see
 * src/lib/dbMirrorGate.ts). A request that replaces every account row is
 * strictly more powerful than reading them, so the same secret guards it.
 *
 * VALIDATION: the payload must parse as a full mirror AND carry at least
 * one account or one system key — an empty/garbage payload must never be
 * able to wipe production. Replacement is a full REPLACE in FK-safe order
 * (see replaceDbFromMirrorObject in src/lib/db.ts); rows absent from the
 * mirror are deleted. The runtime db-mirror.json is refreshed afterwards.
 */
export async function POST(req: NextRequest) {
  const gate = checkDbMirrorKey(req);
  if (!gate.ok) {
    if (gate.diagnostic) console.warn(gate.diagnostic);
    return NextResponse.json(gate.body, { status: gate.status });
  }

  const raw = await req.text();
  if (!raw || raw.length > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "mirror payload missing or too large" },
      { status: 400 },
    );
  }

  const mirror = parseDbMirrorPayload(raw);
  if (!mirror) {
    return NextResponse.json(
      {
        error:
          "invalid mirror payload: must carry at least one account or system key",
      },
      { status: 400 },
    );
  }

  const result = await replaceDbFromMirrorObject(mirror);
  return NextResponse.json(
    {
      ok: true,
      savedAt: mirror.savedAt,
      deleted: result.deleted,
      restored: result.restored,
      tables: result.tables,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
