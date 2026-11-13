import { NextRequest, NextResponse } from "next/server";
import { issueSession, toPublicUser, WebsiteAuthError } from "@/lib/websiteAuth";
import { recoveryTokenFor } from "@/lib/websiteRecovery";
import { verifyRecoveryToken } from "@/lib/websiteRecovery";
import { issueWebsiteOwnerCookie } from "@/lib/websiteCookie";
import { db, ensureDbReady, scheduleDbMirror } from "@/lib/db";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/recover — rebuild a lost session (and, if the database was
 * wiped, the account row itself) from the client-held recovery bundle.
 *
 * THE CLIENT-SIDE HALF OF THE PERMANENT LOGOUT FIX (see
 * src/lib/websiteRecovery.ts for the full story): every deploy recreates the
 * container and the seed-mirror chain has repeatedly failed after workspace
 * resets, seeding an empty production — everyone signed out, accounts and
 * likes gone, users dumped on the "create an account" onboarding. The client
 * now carries a durable bundle (recovery token + cached profile + liked
 * library) and calls THIS endpoint whenever its session is definitively
 * dead. Outcome:
 *   - account still exists  -> plain re-login (fresh tokens, no data change)
 *   - account was wiped     -> rebuilt from the cached profile (same account
 *     id, same username when free, guest flag / email / avatar / settings
 *     preserved) and signed straight back in
 *
 * AUTH: the HMAC recovery token (src/lib/websiteRecovery.ts). Brute force is
 * infeasible (256-bit MAC); failures are uniform so account ids cannot be
 * enumerated. Rate-limited per IP because it can mint sessions.
 *
 * NOTE: a rebuilt account has no password hash (the client never holds one);
 * the recovered user can add a password in Settings -> Account -> Security.
 * Discord accounts re-link discordId automatically on the next
 * "Continue with Discord" (same verified email). Liked tracks arrive right
 * after via the client's re-push of its local library cache.
 */

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;
const rateBucket = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBucket.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    rateBucket.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_MAX;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface RecoveryProfile {
  username?: unknown;
  displayName?: unknown;
  email?: unknown;
  avatarUrl?: unknown;
  bio?: unknown;
  isGuest?: unknown;
  isPublic?: unknown;
  showActivity?: unknown;
  showHistory?: unknown;
  showLikedTracks?: unknown;
  participateLeaderboards?: unknown;
}

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

function clampString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function sanitizeUsername(raw: unknown, accountId: string): string {
  const base =
    typeof raw === "string"
      ? raw.trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24)
      : "";
  if (USERNAME_RE.test(base)) return base;
  // fall back to a stable, collision-safe name derived from the account id
  const fromId = accountId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 18);
  return (fromId.length >= 3 ? fromId : `rc_${accountId.slice(0, 8)}`).slice(0, 24);
}

async function freeUsername(base: string, accountId: string): Promise<string> {
  const direct = await db.account.findUnique({
    where: { username: base },
    select: { id: true },
  });
  if (!direct || direct.id === accountId) return base;
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = `${base.slice(0, 19)}_${crypto.randomBytes(2).toString("hex")}`;
    const taken = await db.account.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  return `rc_${crypto.randomBytes(6).toString("hex")}`;
}

function flag(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many recovery attempts. Try again shortly.", code: "RATE_LIMITED" },
      { status: 429 },
    );
  }

  try {
    const body = (await req.json().catch(() => null)) as {
      accountId?: unknown;
      recoveryToken?: unknown;
      user?: RecoveryProfile;
    } | null;
    const accountId = typeof body?.accountId === "string" ? body.accountId : "";
    const token = typeof body?.recoveryToken === "string" ? body.recoveryToken : "";
    if (!accountId || !token || accountId.length > 64) {
      return NextResponse.json(
        { error: "accountId and recoveryToken are required.", code: "RECOVERY_INVALID" },
        { status: 400 },
      );
    }

    const valid = await verifyRecoveryToken(accountId, token);
    if (!valid) {
      // uniform rejection — no hints whether the id or the token was wrong
      return NextResponse.json(
        { error: "Recovery rejected.", code: "RECOVERY_INVALID" },
        { status: 401 },
      );
    }

    await ensureDbReady();
    let account = await db.account.findUnique({ where: { id: accountId } });
    let rebuilt = false;

    if (!account) {
      // The database was wiped (deploy seeded empty, container recreated).
      // Rebuild the row from the client's cached profile — same account id,
      // so tokens/URLs that reference the id (avatars, handles) keep working.
      const cached = body?.user ?? {};
      const username = await freeUsername(sanitizeUsername(cached.username, accountId), accountId);
      const email =
        flag(cached.isGuest) !== true &&
        typeof cached.email === "string" &&
        EMAIL_RE.test(cached.email.trim())
          ? cached.email.trim().toLowerCase()
          : null;
      // keep recovery payloads small: inline data-URL avatars are capped, and
      // oversized ones live behind GET /api/avatar/{id} anyway (same id)
      const avatarUrl = clampString(cached.avatarUrl, 400_000);
      account = await db.account.create({
        data: {
          id: accountId,
          username,
          displayName: clampString(cached.displayName, 60) ?? username,
          email,
          avatarUrl,
          bio: clampString(cached.bio, 500),
          isGuest: flag(cached.isGuest) === true,
          isPublic: flag(cached.isPublic) === true,
          showActivity: flag(cached.showActivity) === true,
          showHistory: flag(cached.showHistory) !== false,
          showLikedTracks: flag(cached.showLikedTracks) !== false,
          participateLeaderboards: flag(cached.participateLeaderboards) === true,
        },
      });
      rebuilt = true;
      console.log(
        `[auth/recover] account rebuilt from the client bundle (${account.username}, ${accountId})`,
      );
    }

    const session = await issueSession(account.id, req.headers.get("user-agent"));
    scheduleDbMirror();
    const response = NextResponse.json({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      // re-issue under the CURRENT secret so the client's bundle stops
      // depending on the fallback (S2) signature after this recovery
      recoveryToken: await recoveryTokenFor(account.id),
      user: toPublicUser(account),
      recovered: rebuilt,
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
    console.error("[auth/recover]", error);
    return NextResponse.json(
      { error: "Recovery failed. Try again.", code: "RECOVERY_FAILED" },
      { status: 500 },
    );
  }
}
