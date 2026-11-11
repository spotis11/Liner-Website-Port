import { NextRequest, NextResponse } from "next/server";
import {
  createAccount,
  WebsiteAuthError,
  toPublicUser,
} from "@/lib/websiteAuth";
import { issueWebsiteOwnerCookie } from "@/lib/websiteCookie";
import { scheduleDbMirror } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/register — create an account in the website's own database. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 },
      );
    }
    const { account, session } = await createAccount({
      email: String(body.email ?? ""),
      password: String(body.password ?? ""),
      username: String(body.username ?? ""),
      displayName: String(body.displayName ?? ""),
      userAgent: req.headers.get("user-agent"),
    });
    const response = NextResponse.json({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      user: toPublicUser(account),
    });
    issueWebsiteOwnerCookie(response, account.id, account.username);
    scheduleDbMirror();
    return response;
  } catch (error) {
    if (error instanceof WebsiteAuthError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    // unique-constraint races surface as P2002
    if ((error as { code?: string })?.code === "P2002") {
      return NextResponse.json(
        { error: "That email or username is already registered.", code: "TAKEN" },
        { status: 409 },
      );
    }
    console.error("[auth/register]", error);
    return NextResponse.json(
      { error: "Could not create the account. Try again." },
      { status: 500 },
    );
  }
}
