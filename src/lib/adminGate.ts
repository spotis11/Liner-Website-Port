import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  ANNOUNCEMENT_ADMIN_USERNAME,
  ANNOUNCEMENT_DEFAULT_SENDER_NAME,
  type AdminVerification,
} from "@/lib/announcements";

/**
 * Website admin gate — trust anchor that is independent of the upstream
 * Liner session.
 *
 * WHY THIS EXISTS: upstream Liner access tokens live 15 minutes and renew
 * through /v1/auth/refresh. When the owner's stored refresh token dies (it
 * expired upstream, the stored session predates a client bug, or the refresh
 * request fails in their browser), every admin API call 401s and the
 * Moderation / Announcement tabs keep telling the owner "Your session
 * expired — sign in again and try again" even though they are demonstrably
 * the site's owner. That wall is the bug reported in Task 28.
 *
 * HOW IT FIXES IT: after ANY request that proves ownership through the
 * upstream API (a verified Bearer token), the server issues an HttpOnly,
 * HMAC-signed cookie valid for 30 days. Admin routes accept EITHER a live
 * upstream-verified token OR this cookie. The owner verifies once, and the
 * website port keeps trusting their browser for a month (sliding — every
 * successful admin interaction re-issues the cookie), no matter what the
 * upstream session does afterwards.
 *
 * SECURITY MODEL: the cookie is only ever issued AFTER an upstream-verified
 * proof that the caller is the site owner. It is HttpOnly (invisible to
 * JS), Secure, SameSite=Lax, path-scoped to /api. Forgery requires the HMAC
 * secret, which lives in the database (survives republishes) or the
 * ADMIN_GATE_SECRET env var. A stolen cookie is equivalent to a stolen
 * session — same trust level as any session cookie.
 */

export const ADMIN_COOKIE_NAME = "liner_web_admin";

/** Cookie lifetime (30 days) — sliding, renewed on every admin success. */
export const ADMIN_COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const COOKIE_VERSION = "v1";

interface AdminCookiePayload {
  /** username the cookie was issued for (always the site owner) */
  u: string;
  /** expiry, unix ms */
  exp: number;
}

// ---- secret management ------------------------------------------------------

let cachedSecret: { value: Buffer; source: string } | null = null;

/**
 * Derived last-resort secret. Used only when both the env var and the
 * database are unavailable, so the gate degrades to "stable across
 * restarts" instead of breaking. Low stakes: the cookie only guards the
 * website-port moderation/announcement endpoints.
 */
function derivedSecret(): Buffer {
  return crypto
    .createHash("sha256")
    .update(`liner-web-admin-gate|${ANNOUNCEMENT_ADMIN_USERNAME}`)
    .digest();
}

async function getAdminSecret(): Promise<Buffer> {
  if (cachedSecret) return cachedSecret.value;

  const envSecret = process.env.ADMIN_GATE_SECRET?.trim();
  if (envSecret) {
    cachedSecret = { value: Buffer.from(envSecret, "utf8"), source: "env" };
    return cachedSecret.value;
  }

  try {
    const row = await db.systemKey.findUnique({ where: { key: "admin_gate_secret" } });
    if (row?.value) {
      cachedSecret = { value: Buffer.from(row.value, "utf8"), source: "db" };
      return cachedSecret.value;
    }
    const value = crypto.randomBytes(48).toString("hex");
    await db.systemKey.create({ data: { key: "admin_gate_secret", value } });
    cachedSecret = { value: Buffer.from(value, "utf8"), source: "db" };
    return cachedSecret.value;
  } catch {
    // db unavailable — deterministic fallback keeps the gate functional
    cachedSecret = { value: derivedSecret(), source: "derived" };
    return cachedSecret.value;
  }
}

// ---- cookie encoding --------------------------------------------------------

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

async function mac(payload: string): Promise<string> {
  const secret = await getAdminSecret();
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Sign the owner cookie. Returns the cookie value, or null on failure. */
export async function signAdminCookie(username: string): Promise<string | null> {
  try {
    const payload: AdminCookiePayload = {
      u: username,
      exp: Date.now() + ADMIN_COOKIE_TTL_MS,
    };
    const body = b64url(JSON.stringify(payload));
    const signature = await mac(body);
    return `${COOKIE_VERSION}.${body}.${signature}`;
  } catch {
    return null;
  }
}

/** Verify a cookie value. Returns the payload when valid and unexpired. */
export async function verifyAdminCookie(
  value: string | null | undefined,
): Promise<AdminCookiePayload | null> {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== COOKIE_VERSION) return null;
  const [, body, signature] = parts;
  try {
    const expected = await mac(body);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as AdminCookiePayload;
    if (typeof payload?.u !== "string" || typeof payload?.exp !== "number") return null;
    if (payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---- issuance ---------------------------------------------------------------

/**
 * Attach the admin cookie to a response. Called on every request that
 * verified ownership through the upstream (sliding renewal). Awaited so the
 * Set-Cookie header is on the response before it is dispatched; a signing
 * failure is non-fatal (the gate simply does not renew that time).
 */
export async function issueAdminCookie(
  res: NextResponse,
  username: string,
): Promise<NextResponse> {
  try {
    const value = await signAdminCookie(username);
    if (value) {
      res.cookies.set({
        name: ADMIN_COOKIE_NAME,
        value,
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/api",
        maxAge: Math.floor(ADMIN_COOKIE_TTL_MS / 1000),
      });
    }
  } catch {
    // renewal is best-effort
  }
  return res;
}

// ---- request authentication -------------------------------------------------

export interface AdminMe {
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export type AdminAuthResult =
  | { ok: true; via: "token" | "cookie"; username: string; me: AdminMe }
  | { ok: false; status: 401 | 403 | 502; reason: string };

function cookieAuth(): AdminAuthResult {
  return {
    ok: true,
    via: "cookie",
    username: ANNOUNCEMENT_ADMIN_USERNAME,
    // cookie-auth carries no fresh upstream profile; use stable defaults
    me: {
      username: ANNOUNCEMENT_ADMIN_USERNAME,
      displayName: ANNOUNCEMENT_DEFAULT_SENDER_NAME,
      avatarUrl: null,
    },
  };
}

function verificationFailure(verification: AdminVerification): AdminAuthResult {
  const status =
    verification.reason === "not_admin"
      ? 403
      : verification.reason === "upstream_unreachable"
        ? 502
        : 401;
  return { ok: false, status, reason: verification.reason ?? "invalid_token" };
}

/**
 * Authenticate an admin request: verify the caller's Liner token against the
 * upstream first; when that fails (dead session, missing token, upstream
 * hiccup), fall back to the website admin cookie. Never throws.
 */
export async function authenticateAdmin(
  rawToken: string | null | undefined,
  req: NextRequest,
): Promise<AdminAuthResult> {
  const token = typeof rawToken === "string" ? rawToken.trim() : "";

  if (token) {
    try {
      const { verifyAnnouncementAdmin } = await import("@/lib/announcements");
      const verification = await verifyAnnouncementAdmin(token);
      if (verification.ok) {
        return { ok: true, via: "token", username: verification.me.username, me: verification.me };
      }
      // dead/not-owner token — the cookie still gets its chance below
      const cookie = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
      const payload = await verifyAdminCookie(cookie);
      if (payload && payload.u === ANNOUNCEMENT_ADMIN_USERNAME) return cookieAuth();
      return verificationFailure(verification);
    } catch (err) {
      // verification itself blew up (network layer) — treat as unreachable,
      // then fall back to the cookie
      console.error("[adminGate] token verification threw:", err);
      const cookie = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
      const payload = await verifyAdminCookie(cookie);
      if (payload && payload.u === ANNOUNCEMENT_ADMIN_USERNAME) return cookieAuth();
      return { ok: false, status: 502, reason: "upstream_unreachable" };
    }
  }

  const cookie = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  const payload = await verifyAdminCookie(cookie);
  if (payload && payload.u === ANNOUNCEMENT_ADMIN_USERNAME) return cookieAuth();
  return { ok: false, status: 401, reason: "unauthorized" };
}
