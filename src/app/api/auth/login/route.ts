import { NextRequest, NextResponse } from "next/server";
import {
  authenticate,
  WebsiteAuthError,
  toPublicUser,
} from "@/lib/websiteAuth";
import { issueWebsiteOwnerCookie } from "@/lib/websiteCookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/login — email or username + password, against our own db. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const { account, session } = await authenticate(
      String(body?.email ?? ""),
      String(body?.password ?? ""),
      req.headers.get("user-agent"),
    );
    const response = NextResponse.json({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      user: toPublicUser(account),
    });
    issueWebsiteOwnerCookie(response, account.id, account.username);
    return response;
  } catch (error) {
    if (error instanceof WebsiteAuthError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[auth/login]", error);
    return NextResponse.json(
      { error: "Sign in failed. Try again." },
      { status: 500 },
    );
  }
}
