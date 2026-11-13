import { NextRequest, NextResponse } from "next/server";
import { rotateSession, toPublicUser, WebsiteAuthError } from "@/lib/websiteAuth";
import { recoveryTokenFor } from "@/lib/websiteRecovery";
import { scheduleDbMirror } from "@/lib/db";
import { db, ensureDbReady } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/refresh — rotate a refresh token into a fresh pair.
 * The old token dies immediately (one-time use, like upstream).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const refreshToken = String(body?.refreshToken ?? "");
    if (!refreshToken) {
      return NextResponse.json(
        { error: "refreshToken is required", code: "INVALID_REFRESH_TOKEN" },
        { status: 400 },
      );
    }
    const rotated = await rotateSession(refreshToken);
    if (!rotated) {
      return NextResponse.json(
        { error: "Refresh token rejected.", code: "INVALID_REFRESH_TOKEN" },
        { status: 401 },
      );
    }
    await ensureDbReady();
    const account = await db.account.findUnique({
      where: { id: rotated.identity.accountId },
    });
    if (!account) {
      return NextResponse.json(
        { error: "Refresh token rejected.", code: "INVALID_REFRESH_TOKEN" },
        { status: 401 },
      );
    }
    scheduleDbMirror();
    return NextResponse.json({
      recoveryToken: await recoveryTokenFor(rotated.identity.accountId),
      accessToken: rotated.session.accessToken,
      refreshToken: rotated.session.refreshToken,
      accessTokenExpiresAt: rotated.session.accessTokenExpiresAt,
      user: toPublicUser(account),
    });
  } catch (error) {
    if (error instanceof WebsiteAuthError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[auth/refresh]", error);
    return NextResponse.json(
      { error: "Session refresh failed.", code: "REFRESH_FAILED" },
      { status: 500 },
    );
  }
}
