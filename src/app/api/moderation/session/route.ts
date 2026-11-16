import { NextRequest, NextResponse } from "next/server";
import { MODERATION_ADMIN_USERNAME } from "@/lib/moderation";
import { authenticateAdmin, issueAdminCookie } from "@/lib/adminGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Non-erroring admin session probe for the moderation surfaces.
 *
 * The owner-only endpoints (GET /api/moderation/bans, /api/moderation/pro)
 * answer 401 when the browser holds neither a live owner token nor the admin
 * cookie — and the BROWSER logs every failed fetch before JS can catch it,
 * so a stale upstream session spamming the moderation tab produced constant
 * console 401s. This probe answers 200 { authorized } for ANY caller; the
 * panel calls it first and only touches the real endpoints when the token or
 * cookie actually vouches. Same trust decision as the gated routes — it just
 * never shouts.
 */
export async function GET(req: NextRequest) {
  const accessToken =
    (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const auth = await authenticateAdmin(accessToken, req);
  if (!auth.ok) return NextResponse.json({ authorized: false });
  // sliding renewal — same as every other verified admin response
  const res = NextResponse.json({
    authorized: true,
    username: auth.username,
    via: auth.via,
  });
  return issueAdminCookie(res, MODERATION_ADMIN_USERNAME);
}
