import { NextRequest, NextResponse } from "next/server";
import { authenticateAdmin, issueAdminCookie } from "@/lib/adminGate";
import { MODERATION_ADMIN_USERNAME } from "@/lib/moderation";
import {
  ensureOwnerPro,
  grantPro,
  listProUsers,
  normalizeProUsername,
  PRO_OWNER_USERNAME,
  revokePro,
} from "@/lib/pro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liner Pro grants API (site owner only — same auth as /api/moderation/bans).
 *
 * The owner's own account (jayzeyluna) is Pro forever and cannot be revoked;
 * everyone else gets Pro by an explicit grant here (approval-only tier —
 * no payment; approvals happen over Discord, see the Pro tab).
 *
 * GET    /api/moderation/pro → { users: ProUserDTO[] }
 * POST   /api/moderation/pro body { accessToken?, username }  — grant
 * DELETE /api/moderation/pro body { accessToken?, username }  — revoke
 */
function failureResponse(result: { status: number; reason: string }): NextResponse {
  return NextResponse.json({ error: result.reason }, { status: result.status });
}

export async function GET(req: NextRequest) {
  const accessToken = (req.headers.get("authorization") ?? "")
    .match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const auth = await authenticateAdmin(accessToken, req);
  if (!auth.ok) return failureResponse(auth);
  await ensureOwnerPro();
  const users = await listProUsers();
  const res = NextResponse.json({ users, owner: PRO_OWNER_USERNAME });
  return issueAdminCookie(res, MODERATION_ADMIN_USERNAME);
}

export async function POST(req: NextRequest) {
  const accessToken = (req.headers.get("authorization") ?? "")
    .match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const auth = await authenticateAdmin(accessToken, req);
  if (!auth.ok) return failureResponse(auth);

  const body = (await req.json().catch(() => ({}))) as { username?: unknown };
  const username = normalizeProUsername(body.username);
  if (!username) {
    return NextResponse.json({ error: "invalid_username" }, { status: 400 });
  }

  const result = await grantPro(username, MODERATION_ADMIN_USERNAME);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  const users = await listProUsers();
  const res = NextResponse.json({ ok: true, username, users });
  return issueAdminCookie(res, MODERATION_ADMIN_USERNAME);
}

export async function DELETE(req: NextRequest) {
  const accessToken = (req.headers.get("authorization") ?? "")
    .match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const auth = await authenticateAdmin(accessToken, req);
  if (!auth.ok) return failureResponse(auth);

  const body = (await req.json().catch(() => ({}))) as { username?: unknown };
  const username = normalizeProUsername(body.username);
  if (!username) {
    return NextResponse.json({ error: "invalid_username" }, { status: 400 });
  }

  const result = await revokePro(username);
  if (!result.ok) {
    if (result.error === "cannot_revoke_owner") {
      return NextResponse.json(
        { error: "cannot_revoke_owner" },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  const users = await listProUsers();
  const res = NextResponse.json({ ok: true, username, users });
  return issueAdminCookie(res, MODERATION_ADMIN_USERNAME);
}
