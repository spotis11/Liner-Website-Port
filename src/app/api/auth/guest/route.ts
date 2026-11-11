import { NextRequest, NextResponse } from "next/server";
import { createGuestAccount, guestPublicUser } from "@/lib/websiteAuth";
import { issueWebsiteOwnerCookie } from "@/lib/websiteCookie";
import { scheduleDbMirror } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/guest — one-tap guest mode: mints a real guest account in
 * the website's own database (permanent, like any other account) and signs
 * it in. No email, no password, no captcha. A returning browser keeps the
 * same guest via its stored tokens; the account row outlives restarts.
 */
export async function POST(req: NextRequest) {
  try {
    const { account, session } = await createGuestAccount(
      req.headers.get("user-agent"),
    );
    const response = NextResponse.json({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      user: guestPublicUser(account),
    });
    issueWebsiteOwnerCookie(response, account.id, account.username);
    scheduleDbMirror();
    return response;
  } catch (error) {
    console.error("[auth/guest]", error);
    return NextResponse.json(
      { error: "Guest mode failed. Try again." },
      { status: 500 },
    );
  }
}
