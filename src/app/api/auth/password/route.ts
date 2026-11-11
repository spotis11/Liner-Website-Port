import { NextRequest, NextResponse } from "next/server";
import {
  verifyAccessToken,
  setAccountPassword,
  WebsiteAuthError,
} from "@/lib/websiteAuth";
import { scheduleDbMirror } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/password — set or change the signed-in account's password.
 * Discord-linked (passwordless) accounts only need the new password; accounts
 * that already have one must confirm the current password. Mirrored tables are
 * scheduled for write-back so the change survives republishes.
 */
export async function POST(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const identity = await verifyAccessToken(bearer);
  if (!identity) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body." }, { status: 400 });
    }
    await setAccountPassword({
      accountId: identity.accountId,
      currentPassword:
        typeof body.currentPassword === "string" && body.currentPassword
          ? body.currentPassword
          : undefined,
      password: typeof body.password === "string" ? body.password : "",
    });
    scheduleDbMirror();
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof WebsiteAuthError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[auth/password]", error);
    return NextResponse.json(
      { error: "Could not set the password. Try again." },
      { status: 500 },
    );
  }
}
