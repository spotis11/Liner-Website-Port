import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken, toPublicUser } from "@/lib/websiteAuth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/me — the signed-in account's public profile (Bearer). */
export async function GET(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const identity = await verifyAccessToken(bearer);
  if (!identity) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const account = await db.account.findUnique({
    where: { id: identity.accountId },
  });
  if (!account) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  return NextResponse.json(toPublicUser(account));
}
