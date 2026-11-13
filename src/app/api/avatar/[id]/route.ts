import { NextRequest, NextResponse } from "next/server";
import { db, ensureDbReady } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/avatar/[id] — serves an account's avatar bytes.
 *
 * Oversized avatars (Liner Pro animated GIFs up to 30 MB — ~42 MB as a base64
 * data URL) are NOT inlined into JSON payloads: toPublicUser() rewrites them
 * to this endpoint URL so /me, user finder, announcements and moderation
 * payloads stay light. The browser caches the bytes here instead.
 *
 * Small data-URL avatars (<= 400k chars) stay inline as before; http(s)
 * avatars (e.g. Discord CDN) 302-redirect so the client hits the origin
 * directly.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || typeof id !== "string" || id.length > 64) {
    return NextResponse.json({ error: "Invalid account id." }, { status: 400 });
  }
  await ensureDbReady();
  const account = await db.account
    .findUnique({ where: { id }, select: { avatarUrl: true } })
    .catch(() => null);
  if (!account?.avatarUrl) {
    return NextResponse.json({ error: "Avatar not found." }, { status: 404 });
  }
  const avatarUrl = account.avatarUrl;

  // http(s) avatar (Discord CDN etc.) — redirect to the origin directly.
  if (!avatarUrl.startsWith("data:")) {
    try {
      const target = new URL(avatarUrl);
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        return NextResponse.json(
          { error: "Unsupported avatar URL." },
          { status: 404 },
        );
      }
      return NextResponse.redirect(target.toString(), {
        status: 302,
        headers: { "Cache-Control": "public, max-age=300" },
      });
    } catch {
      return NextResponse.json(
        { error: "Invalid avatar URL." },
        { status: 404 },
      );
    }
  }

  // data:[mime][;base64],payload — decode and stream the bytes.
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(avatarUrl);
  if (!match) {
    return NextResponse.json(
      { error: "Malformed avatar data." },
      { status: 404 },
    );
  }
  const mime = match[1] || "application/octet-stream";
  const isBase64 = match[2] === ";base64";
  const bytes = isBase64
    ? Buffer.from(match[3], "base64")
    : Buffer.from(decodeURIComponent(match[3]), "utf8");
  if (bytes.length === 0) {
    return NextResponse.json({ error: "Avatar is empty." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
