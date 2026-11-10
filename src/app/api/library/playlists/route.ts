import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/websiteAuth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/library/playlists — the account's playlists, newest update first. */
export async function GET(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const identity = await verifyAccessToken(bearer);
  if (!identity) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const playlists = await db.accountPlaylist.findMany({
    where: { accountId: identity.accountId },
    orderBy: { updatedAt: "desc" },
    include: { items: { orderBy: { position: "asc" }, take: 1 } },
  });
  return NextResponse.json({
    items: playlists.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description ?? undefined,
      isPublic: p.isPublic,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      revision: p.revision,
      ownerId: identity.accountId,
      owner: { id: identity.accountId, username: identity.username },
      trackCount: undefined,
      coverUrls: p.items
        .map((i) => (i.snapshot ? JSON.parse(i.snapshot) : null))
        .filter(Boolean)
        .map((t) => t.coverUrl)
        .filter(Boolean),
    })),
  });
}

/** POST /api/library/playlists — create a playlist. */
export async function POST(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const identity = await verifyAccessToken(bearer);
  if (!identity) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const title = String(body?.title ?? "").trim();
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const playlist = await db.accountPlaylist.create({
    data: {
      accountId: identity.accountId,
      title: title.slice(0, 120),
      description: body?.description
        ? String(body.description).slice(0, 500)
        : null,
      isPublic: body?.isPublic === true,
    },
  });
  return NextResponse.json({
    id: playlist.id,
    title: playlist.title,
    description: playlist.description ?? undefined,
    isPublic: playlist.isPublic,
    createdAt: playlist.createdAt.toISOString(),
    updatedAt: playlist.updatedAt.toISOString(),
    revision: playlist.revision,
    ownerId: identity.accountId,
    owner: { id: identity.accountId, username: identity.username },
    trackCount: 0,
  });
}
