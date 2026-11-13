import { NextRequest, NextResponse } from "next/server";
import {
  verifyAccessToken,
  toPublicUser,
  normalizeUsername,
} from "@/lib/websiteAuth";
import { isOwnerPro } from "@/lib/pro";
import { db, scheduleDbMirror } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Upstream Liner username rules — matches the client editor's pattern and
// normalizeProUsername in lib/pro. The old 3-24 cap rejected usernames the
// settings UI happily accepted (e.g. 25-30 character handles) and surfaced
// as a "profile save failed" toast with no way to tell why.
const USERNAME_RE = /^[a-z0-9_]{3,30}$/;
// Same cap as the client editor (BIO_MAX in AccountTab) — the old 300
// silently truncated every longer bio the UI allowed.
const BIO_MAX = 500;

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

  const data: Record<string, string | boolean | null> = {};
  // UpdateProfileInput types displayName/bio/avatarUrl as `string | null`:
  // the client sends an explicit null to CLEAR a field ("remove avatar",
  // empty bio box, emptied name box). A null used to be silently dropped
  // here — the request returned 200, the toast said "saved", and nothing
  // changed, which read as "updating profile isn't working". Honor null as
  // a real clear from now on.
  //
  // Username is processed FIRST so a same-patch displayName clear falls
  // back to the NEW username, not the old one.
  if (typeof body.username === "string") {
    const username = normalizeUsername(body.username);
    if (!USERNAME_RE.test(username)) {
      return NextResponse.json(
        {
          error: "Username must be 3-30 lowercase letters, digits or underscores.",
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
  if (body.displayName === null || typeof body.displayName === "string") {
    if (body.displayName === null) {
      // cleared name box: the schema requires a non-empty display name, so
      // fall back to the (possibly just-changed) username
      data.displayName = data.username ?? identity.username;
    } else {
      const trimmed = body.displayName.trim();
      if (!trimmed || trimmed.length > 60) {
        return NextResponse.json(
          { error: "Display name must be 1-60 characters.", code: "INVALID_DISPLAY_NAME" },
          { status: 400 },
        );
      }
      data.displayName = trimmed;
    }
  }
  if (body.bio === null || typeof body.bio === "string") {
    data.bio = body.bio === null ? null : body.bio.trim().slice(0, BIO_MAX);
  }
  if (body.avatarUrl === null || typeof body.avatarUrl === "string") {
    if (body.avatarUrl === null) {
      // the "Remove avatar" button — actually clear it instead of no-op'ing
      data.avatarUrl = null;
    } else {
      // Liner Pro unlocks animated GIF avatars up to 30 MB (~41.95M chars of
      // base64 + prefix headroom); everyone else keeps the compact cap. Reject
      // rather than slice — slicing a data URL corrupts it into a broken image.
      const proAccount = await db.account.findUnique({
        where: { id: identity.accountId },
        select: { isPro: true },
      });
      const isPro = Boolean(proAccount?.isPro) || isOwnerPro(identity.username);
      const cap = isPro ? 41_950_000 : 400_000;
      if (body.avatarUrl.length > cap) {
        return NextResponse.json(
          {
            error: isPro
              ? "Avatar too large. Liner Pro allows animated avatars up to 30 MB."
              : "Avatar too large. Animated avatars up to 30 MB are a Liner Pro feature.",
            code: "AVATAR_TOO_LARGE",
          },
          { status: 413 },
        );
      }
      data.avatarUrl = body.avatarUrl;
    }
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
    // ride the deploy-time mirror like every other auth route — without
    // this the fallback seed went stale and profile edits could vanish on
    // a cache-restored deploy
    scheduleDbMirror();
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
