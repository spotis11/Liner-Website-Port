import { NextRequest, NextResponse } from "next/server";
import {
  BAN_REASON_MAX,
  MODERATION_ADMIN_USERNAME,
  addBan,
  listBans,
  normalizeUsername,
  removeBan,
} from "@/lib/moderation";
import { authenticateAdmin, issueAdminCookie } from "@/lib/adminGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Website-port moderation API (site owner only).
 *
 * Authentication: the caller's Liner access token is verified against the
 * upstream API and must belong to the site owner. When the token cannot be
 * verified (dead session, missing token), the website admin cookie issued by
 * a previous successful verification vouches for the browser instead — so a
 * dead upstream session never locks the owner out of their own moderation
 * panel ("session expired" wall, Task 28).
 *
 * GET    /api/moderation/bans → { bans: BanDTO[] }
 * POST   /api/moderation/bans body { accessToken, username,
 *        type: "normal" | "ip", durationHours: number | null, reason? }
 * DELETE /api/moderation/bans body { accessToken, username }
 */

/**
 * 401 = neither the token nor the admin cookie vouches for the caller
 * (client shows "session expired"), 403 = verified but not the owner,
 * 502 = upstream unreachable (NOT a dead token — the client must show a
 * neutral "try again" instead of blaming the session).
 */
function failureResponse(result: { status: number; reason: string }): NextResponse {
  return NextResponse.json({ error: result.reason }, { status: result.status });
}

export async function GET(req: NextRequest) {
  const accessToken = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const auth = await authenticateAdmin(accessToken, req);
  if (!auth.ok) return failureResponse(auth);
  const bans = await listBans();
  const res = NextResponse.json({ bans });
  return issueAdminCookie(res, MODERATION_ADMIN_USERNAME);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const accessToken =
    typeof body?.accessToken === "string" ? body.accessToken.trim() : "";
  const auth = await authenticateAdmin(accessToken, req);
  if (!auth.ok) return failureResponse(auth);

  const username = normalizeUsername(body?.username);
  if (!username) {
    return NextResponse.json({ error: "invalid_username" }, { status: 400 });
  }
  const type = body?.type === "ip" ? "ip" : body?.type === "normal" ? "normal" : null;
  if (!type) {
    return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  }
  const rawDuration = body?.durationHours;
  const durationHours =
    rawDuration === null || rawDuration === undefined ? null : Number(rawDuration);
  if (durationHours !== null && !Number.isFinite(durationHours)) {
    return NextResponse.json({ error: "invalid_duration" }, { status: 400 });
  }
  const reason =
    typeof body?.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, BAN_REASON_MAX + 1)
      : null;

  const result = await addBan({
    username,
    type,
    durationHours,
    reason,
    createdBy: auth.username,
    // powers the live upstream email lookup when the ban mail has no cached
    // address (the notification is fire-and-forget and never blocks this)
    ownerAccessToken: accessToken,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const res = NextResponse.json({ ban: result.ban });
  return issueAdminCookie(res, MODERATION_ADMIN_USERNAME);
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const accessToken =
    typeof body?.accessToken === "string" ? body.accessToken.trim() : "";
  const auth = await authenticateAdmin(accessToken, req);
  if (!auth.ok) return failureResponse(auth);

  const username = normalizeUsername(body?.username);
  if (!username) {
    return NextResponse.json({ error: "invalid_username" }, { status: 400 });
  }
  const result = await removeBan(username);
  if (!result.ok) {
    const status = result.error === "not_banned" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  const res = NextResponse.json({ ok: true, removedIps: result.removedIps });
  return issueAdminCookie(res, MODERATION_ADMIN_USERNAME);
}
