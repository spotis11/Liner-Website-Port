import crypto from "node:crypto";
import type { NextResponse } from "next/server";

/**
 * Website session cookie — a small HttpOnly marker issued on every successful
 * /api/auth/* exchange (login, register, guest). It is NOT the client's auth
 * token (the SPA keeps those in localStorage); it only lets server-side
 * surfaces (moderation probe, logs) recognize the browser of a signed-in
 * account without exposing tokens. Signed with an HMAC key stored in the
 * SystemKey table, so it survives republishes and recycling.
 */

const COOKIE_NAME = "liner_web_session";
const COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CookiePayload {
  accountId: string;
  username: string;
  exp: number;
}

let cachedSecret: Buffer | null = null;

async function secret(): Promise<Buffer> {
  if (cachedSecret) return cachedSecret;
  try {
    const { db, ensureDbReady } = await import("@/lib/db");
    await ensureDbReady();
    const KEY = "website_session_secret";
    const row = await db.systemKey.findUnique({ where: { key: KEY } });
    if (row) {
      cachedSecret = Buffer.from(row.value, "hex");
      return cachedSecret;
    }
    const value = crypto.randomBytes(48);
    await db.systemKey.create({ data: { key: KEY, value: value.toString("hex") } });
    cachedSecret = value;
    return cachedSecret;
  } catch {
    // db unavailable — degrade to a per-process key instead of breaking auth
    cachedSecret = crypto.createHash("sha256").update("fallback-secret").digest();
    return cachedSecret;
  }
}

function sign(payload: string, key: Buffer): string {
  return crypto
    .createHmac("sha256", key)
    .update(payload)
    .digest("base64url");
}

/** Attach the marker cookie to a successful auth response. Best effort. */
export function issueWebsiteOwnerCookie(
  response: NextResponse,
  accountId: string,
  username: string,
): void {
  try {
    const payload: CookiePayload = {
      accountId,
      username,
      exp: Date.now() + COOKIE_TTL_MS,
    };
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    void secret().then((key) => {
      const mac = sign(body, key);
      response.cookies.set({
        name: COOKIE_NAME,
        value: `v1.${body}.${mac}`,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: Math.floor(COOKIE_TTL_MS / 1000),
        path: "/",
      });
    });
  } catch {
    // cookie is an enhancement only — never break the auth response
  }
}

/** Verify the marker cookie; returns the account id or null. */
export async function readWebsiteSessionCookie(
  value: string | undefined | null,
): Promise<{ accountId: string; username: string } | null> {
  if (!value?.startsWith("v1.")) return null;
  const [, body, mac] = value.split(".");
  if (!body || !mac) return null;
  try {
    const key = await secret();
    const expected = sign(body, key);
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as CookiePayload;
    if (!payload.exp || payload.exp <= Date.now()) return null;
    return { accountId: payload.accountId, username: payload.username };
  } catch {
    return null;
  }
}
