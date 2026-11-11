import { NextRequest, NextResponse } from "next/server";
import {
  verifyAccessToken,
  toPublicUser,
  normalizeUsername,
} from "@/lib/websiteAuth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

/**
 * PATCH /api/auth/profile — edit the signed-in account's profile.
 * Same-origin, so the old CORS-constrained /v1/users/me PATCH proxy hop is gone.
 */
export async function PATCH(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const identity = await verifyAccessToken(bearer);
  if (!identity) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const data: Record<string, string | boolean> = {};
  if (typeof body.displayName === "string") {
    const trimmed = body.displayName.trim();
    if (!trimmed || trimmed.length > 60) {
      return NextResponse.json(
        { error: "Display name must be 1-60 characters.", code: "INVALID_DISPLAY_NAME" },
        { status: 400 },
      );
    }
    data.displayName = trimmed;
  }
  if (typeof body.bio === "string") {
    data.bio = body.bio.trim().slice(0, 300);
  }
  if (typeof body.avatarUrl === "string") {
    data.avatarUrl = body.avatarUrl.slice(0, 400_000);
  }
  if (typeof body.username === "string") {
    const username = normalizeUsername(body.username);
    if (!USERNAME_RE.test(username)) {
      return NextResponse.json(
        {
          error: "Username must be 3-24 lowercase letters, digits or underscores.",
          code: "INVALID_USERNAME",
        },
        { status: 400 },
      );
    }
    const taken = await db.account.findUnique({
      where: { username },
      select: { id: true },
    });
    if (taken && taken.id !== identity.accountId) {
      // return (not throw): an uncaught WebsiteAuthError here would surface
      // as a 500 and the client would never see the USERNAME_TAKEN code
      return NextResponse.json(
        { error: "That username is already taken.", code: "USERNAME_TAKEN" },
        { status: 409 },
      );
    }
    data.username = username;
  }
  for (const flag of [
    "isPublic",
    "showActivity",
    "showHistory",
    "showLikedTracks",
    "participateLeaderboards",
  ] as const) {
    if (typeof body[flag] === "boolean") data[flag] = body[flag];
  }

  try {
    const account = await db.account.update({
      where: { id: identity.accountId },
      data,
    });
    return NextResponse.json(toPublicUser(account));
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") {
      return NextResponse.json(
        { error: "That username is already taken.", code: "USERNAME_TAKEN" },
        { status: 409 },
      );
    }
    console.error("[auth/profile]", error);
    return NextResponse.json(
      { error: "Profile update failed." },
      { status: 500 },
    );
  }
}
