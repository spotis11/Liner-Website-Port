import { NextRequest, NextResponse } from "next/server";
import { authenticateAdmin, issueAdminCookie } from "@/lib/adminGate";
import { MODERATION_ADMIN_USERNAME } from "@/lib/moderation";
import { getShowcase, setShowcase } from "@/lib/showcase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Website Showcase ("randomize website") switch.
 *
 * GET  /api/showcase → public probe the SPA makes on boot, every 15s while
 *      open and when the tab becomes visible again. Always answers 200 and
 *      is never gated (cosmetic mode; also stays answerable while the
 *      maintenance wall is up so the owner can still flip things off).
 *
 * POST /api/showcase → site owner only (same admin gate as moderation and
 *      maintenance: verified owner token OR the website admin cookie).
 *      Body: { enabled: boolean, accessToken? }.
 */
export async function GET() {
  const state = await getShowcase();
  return NextResponse.json({
    enabled: state.enabled,
    updatedAt: state.updatedAt,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const accessToken =
    typeof body?.accessToken === "string" ? body.accessToken.trim() : "";
  const auth = await authenticateAdmin(accessToken, req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "invalid_enabled" }, { status: 400 });
  }

  const state = await setShowcase(body.enabled);
  const res = NextResponse.json({
    enabled: state.enabled,
    updatedAt: state.updatedAt,
  });
  return issueAdminCookie(res, MODERATION_ADMIN_USERNAME);
}
