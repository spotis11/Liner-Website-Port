import { NextRequest, NextResponse } from "next/server";
import {
  clientIpFromHeader,
  evaluateBan,
  recordIpSeen,
  recordUserSeen,
  verifyLinerTokenFull,
} from "@/lib/moderation";
import { ANNOUNCEMENT_ADMIN_USERNAME } from "@/lib/announcements";
import { issueAdminCookie } from "@/lib/adminGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public ban probe — every website client calls this on boot, after sign-in
 * and periodically while the app is open. Always answers 200 (fail-open on
 * transport issues is handled client-side; db errors fail open server-side)
 * so a probe can never break a visitor's session.
 *
 * Body: { username?, accessToken? }
 *  - When a username + token pair verifies against the upstream API, the
 *    caller's network address is recorded (best effort) so the site owner's
 *    "ip" bans can freeze the right addresses.
 *  - When the verified account is the site owner, the website admin cookie
 *    is (re-)issued — this is how the owner's browser silently keeps its
 *    30-day moderation gate credential alive on every visit, independent of
 *    upstream session churn (Task 28).
 *  - Evaluation itself never needs the upstream: banned username or banned
 *    network address → { banned: true, type, reason, expiresAt }.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rawUsername =
    typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
  const accessToken =
    typeof body?.accessToken === "string" ? body.accessToken.trim() : "";
  const ip = clientIpFromHeader(
    req.headers.get("x-forwarded-for"),
    req.headers.get("x-real-ip"),
  );

  let verifiedAdmin = false;
  if (rawUsername && accessToken) {
    const verified = await verifyLinerTokenFull(accessToken);
    // only verified sightings are recorded — unverified claims are ignored
    if (verified && verified.username === rawUsername) {
      await recordIpSeen(ip, verified.username);
      // cache what the account's own session proves about it (User Finder)
      await recordUserSeen(verified);
      verifiedAdmin = verified.username === ANNOUNCEMENT_ADMIN_USERNAME;
    }
  }

  const result = await evaluateBan({
    username: rawUsername || null,
    ip,
  });
  const res = NextResponse.json(result);
  return verifiedAdmin ? issueAdminCookie(res, ANNOUNCEMENT_ADMIN_USERNAME) : res;
}
