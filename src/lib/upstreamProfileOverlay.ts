// Local profile overlay for UPSTREAM Liner sessions (api.tryliner.fun JWTs).
//
// WHY: the upstream API has no profile-edit route at all — PATCH/PUT/POST on
// /v1/users/me, /v1/me, /v1/user, /v1/profile all answer 404 ("Route
// PATCH:/v1/users/me not found", verified live 2026-11-14 with a real
// upstream session). The desktop app simply doesn't ship profile editing, so
// every "Save changes" click on the Account tab surfaced as "Failed to
// update profile" for upstream (email/password) sign-ins — while website
// sessions (Discord/guest, at_ tokens) already save through /api/auth/profile.
//
// HOW: profile edits made under an upstream session are stored in the
// UpstreamProfile table (keyed by the upstream JWT `sub`, validated exactly
// like the website route) and merged into the relayed responses:
//  - GET /v1/me          -> upstream user + overlay fields
//  - PATCH /v1/users/me  -> stored locally, answered locally (200 + merged user)
// The Liner Pro overlay (linerProOverlay.ts) runs on the upstream username
// BEFORE this merge, so Pro stays tied to the real upstream account even if
// the display username is overridden here.
//
// Field semantics (UpstreamProfile): nullable = "not overridden, pass the
// upstream value through"; bio/avatarUrl use "" as an explicit "cleared"
// marker (the client sends null to clear, which upstream would never echo).
import { isOwnerPro } from "@/lib/pro";
import { db, ensureDbReady, scheduleDbMirror } from "@/lib/db";

const USERNAME_RE = /^[a-z0-9_]{3,30}$/;
const BIO_MAX = 500;
const DISPLAY_NAME_MAX = 60;
const AVATAR_INLINE_MAX_CHARS = 400_000;
const AVATAR_PRO_CAP_CHARS = 41_950_000;

export class UpstreamProfileError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Pro on this website port: the owner by username, or an Account grant. */
async function websitePro(username: string): Promise<boolean> {
  if (isOwnerPro(username)) return true;
  try {
    const row = await db.account.findUnique({
      where: { username },
      select: { isPro: true },
    });
    return Boolean(row?.isPro);
  } catch {
    return false;
  }
}

/** Rewrite an oversized data-URL avatar to the byte-serving endpoint. */
function rewriteAvatar(avatarUrl: string, profileId: string): string {
  return avatarUrl.startsWith("data:") && avatarUrl.length > AVATAR_INLINE_MAX_CHARS
    ? `/api/avatar/${profileId}`
    : avatarUrl;
}

/**
 * Merge a stored UpstreamProfile row into an upstream user object
 * (mutates + returns it). Only non-null row fields override; "" means the
 * user explicitly cleared the field (mapped to null like the website route).
 */
export function mergeUpstreamProfile(
  user: Record<string, unknown>,
  row: {
    id: string;
    username: string | null;
    displayName: string | null;
    bio: string | null;
    avatarUrl: string | null;
    isPublic: boolean | null;
    showActivity: boolean | null;
    showHistory: boolean | null;
    showLikedTracks: boolean | null;
    participateLeaderboards: boolean | null;
  },
): Record<string, unknown> {
  if (row.username) user.username = row.username;
  if (row.displayName !== null) user.displayName = row.displayName;
  if (row.bio !== null) user.bio = row.bio === "" ? null : row.bio;
  if (row.avatarUrl !== null) {
    user.avatarUrl = row.avatarUrl === "" ? null : rewriteAvatar(row.avatarUrl, row.id);
  }
  for (const flag of [
    "isPublic",
    "showActivity",
    "showHistory",
    "showLikedTracks",
    "participateLeaderboards",
  ] as const) {
    const value = row[flag];
    if (value !== null) user[flag] = value;
  }
  return user;
}

/** GET /v1/me merge point: overlay the stored profile onto the relayed user. */
export async function overlayUpstreamProfile(
  body: ArrayBuffer,
  contentType: string | null,
): Promise<ArrayBuffer> {
  if (!contentType?.includes("application/json") || body.byteLength === 0) {
    return body;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return body;
  }
  const record = parsed as Record<string, unknown>;
  const user =
    record.user && typeof record.user === "object"
      ? (record.user as Record<string, unknown>)
      : record;
  const sub = user?.id;
  if (typeof sub !== "string" || !sub) return body;
  const row = await db.upstreamProfile
    .findUnique({ where: { upstreamSub: sub } })
    .catch(() => null);
  if (!row) return body;
  mergeUpstreamProfile(user, row);
  return new TextEncoder().encode(JSON.stringify(record)).buffer as ArrayBuffer;
}

/**
 * PATCH /v1/users/me for an upstream session: validate exactly like
 * /api/auth/profile, upsert the overlay row, answer with the merged user.
 * `upstreamUser` is the REAL user from the upstream GET /v1/me validation hop
 * (the token was proven against the upstream — client claims are never
 * trusted for the overlay key).
 */
export async function applyUpstreamProfilePatch(
  upstreamUser: Record<string, unknown>,
  patchBody: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await ensureDbReady();
  const sub = typeof upstreamUser.id === "string" ? upstreamUser.id : null;
  const upstreamUsername =
    typeof upstreamUser.username === "string" ? upstreamUser.username : null;
  if (!sub || !upstreamUsername) {
    throw new UpstreamProfileError(502, "UPSTREAM_SHAPE", "Upstream user payload incomplete.");
  }

  const data: Record<string, string | boolean | null> = {};

  // username FIRST (same order as the website route: a same-patch
  // displayName clear must fall back to the new username)
  let nextUsername = upstreamUsername;
  if (typeof patchBody.username === "string") {
    const username = patchBody.username.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) {
      throw new UpstreamProfileError(
        400,
        "INVALID_USERNAME",
        "Username must be 3-30 lowercase letters, digits or underscores.",
      );
    }
    if (username !== upstreamUsername) {
      // taken = a website Account or another upstream overlay already uses it
      const [accountRow, profileRow] = await Promise.all([
        db.account.findUnique({ where: { username }, select: { id: true } }),
        db.upstreamProfile.findFirst({
          where: { username, upstreamSub: { not: sub } },
          select: { id: true },
        }),
      ]);
      if (accountRow || profileRow) {
        throw new UpstreamProfileError(409, "USERNAME_TAKEN", "That username is already taken.");
      }
    }
    data.username = username;
    nextUsername = username;
  }

  if (patchBody.displayName === null || typeof patchBody.displayName === "string") {
    if (patchBody.displayName === null) {
      const fallback =
        (typeof upstreamUser.displayName === "string" && upstreamUser.displayName.trim()) ||
        nextUsername;
      data.displayName = String(fallback).trim().slice(0, DISPLAY_NAME_MAX) || nextUsername;
    } else {
      const trimmed = patchBody.displayName.trim();
      if (!trimmed || trimmed.length > DISPLAY_NAME_MAX) {
        throw new UpstreamProfileError(
          400,
          "INVALID_DISPLAY_NAME",
          "Display name must be 1-60 characters.",
        );
      }
      data.displayName = trimmed;
    }
  }

  if (patchBody.bio === null || typeof patchBody.bio === "string") {
    data.bio = patchBody.bio === null ? "" : patchBody.bio.trim().slice(0, BIO_MAX);
  }

  if (patchBody.avatarUrl === null || typeof patchBody.avatarUrl === "string") {
    if (patchBody.avatarUrl === null) {
      data.avatarUrl = "";
    } else {
      const isPro = await websitePro(nextUsername);
      const cap = isPro ? AVATAR_PRO_CAP_CHARS : AVATAR_INLINE_MAX_CHARS;
      if (patchBody.avatarUrl.length > cap) {
        throw new UpstreamProfileError(
          413,
          "AVATAR_TOO_LARGE",
          isPro
            ? "Avatar too large. Liner Pro allows animated avatars up to 30 MB."
            : "Avatar too large. Animated avatars up to 30 MB are a Liner Pro feature.",
        );
      }
      data.avatarUrl = patchBody.avatarUrl;
    }
  }

  for (const flag of [
    "isPublic",
    "showActivity",
    "showHistory",
    "showLikedTracks",
    "participateLeaderboards",
  ] as const) {
    if (typeof patchBody[flag] === "boolean") data[flag] = patchBody[flag];
  }

  const row = await db.upstreamProfile.upsert({
    where: { upstreamSub: sub },
    create: { upstreamSub: sub, ...data },
    update: data,
  });

  // ride the deploy-time mirror like every other auth route
  scheduleDbMirror();

  // answer exactly like the website PATCH: the merged PublicUser-ish shape
  const merged: Record<string, unknown> = {
    ...upstreamUser,
    username: row.username ?? upstreamUsername,
    displayName: row.displayName ?? upstreamUser.displayName ?? upstreamUsername,
    bio: row.bio === null ? (upstreamUser.bio ?? null) : row.bio === "" ? null : row.bio,
    avatarUrl:
      row.avatarUrl === null
        ? (upstreamUser.avatarUrl ?? null)
        : row.avatarUrl === ""
          ? null
          : rewriteAvatar(row.avatarUrl, row.id),
    email: upstreamUser.email ?? undefined,
    isPro: Boolean(upstreamUser.isPro) || (await websitePro(row.username ?? upstreamUsername)),
  };
  return merged;
}
