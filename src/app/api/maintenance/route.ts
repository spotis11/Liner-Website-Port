import { NextRequest, NextResponse } from "next/server";
import { authenticateAdmin, issueAdminCookie } from "@/lib/adminGate";
import { MODERATION_ADMIN_USERNAME } from "@/lib/moderation";
import { getMaintenance, setMaintenance } from "@/lib/maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Website-port maintenance switch.
 *
 * GET  /api/maintenance → public probe the SPA makes on boot (and every
 *      30s while open). ALWAYS answers 200 — even during maintenance —
 *      because this response is exactly what raises/releases the client
 *      wall. Never gate this route with its own wall.
 *
 * POST /api/maintenance → site owner only (same admin gate as moderation:
 *      verified owner token OR the website admin cookie). Body:
 *      { enabled: boolean, accessToken?, reasons?: string[] }.
 *      Empty/missing reasons fall back to the built-in default list.
 */
export async function GET() {
  const state = await getMaintenance();
  return NextResponse.json({
    enabled: state.enabled,
    reasons: state.reasons,
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
  const reasons = Array.isArray(body?.reasons)
    ? body.reasons.map((r: unknown) => String(r)).filter((r: string) => r.trim().length > 0)
    : undefined;

  const state = await setMaintenance(body.enabled, reasons);
  const res = NextResponse.json({
    enabled: state.enabled,
    reasons: state.reasons,
    updatedAt: state.updatedAt,
  });
  return issueAdminCookie(res, MODERATION_ADMIN_USERNAME);
}
