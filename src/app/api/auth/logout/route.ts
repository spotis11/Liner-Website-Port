import { NextRequest, NextResponse } from "next/server";
import { destroySessionByRefreshToken } from "@/lib/websiteAuth";
import { scheduleDbMirror } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/logout — kill the session row behind the refresh token. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  await destroySessionByRefreshToken(body?.refreshToken).catch(() => undefined);
  scheduleDbMirror();
  const response = NextResponse.json({ ok: true });
  // best-effort marker cleanup
  try {
    response.cookies.set({
      name: "liner_web_session",
      value: "",
      httpOnly: true,
      path: "/",
      maxAge: 0,
    });
  } catch {}
  return response;
}
