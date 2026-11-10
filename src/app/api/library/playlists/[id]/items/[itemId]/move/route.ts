import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/websiteAuth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string; itemId: string }>;
};

/**
 * POST /api/library/playlists/[id]/items/[itemId]/move — move one row so it
 * sits right before beforeItemId (or at the end when null). Returns the
 * playlist with its items in the new order.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const identity = await verifyAccessToken(bearer);
  if (!identity) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { id, itemId } = await params;
  const playlist = await db.accountPlaylist.findFirst({
    where: { id, accountId: identity.accountId },
  });
  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const beforeItemId =
    typeof body?.beforeItemId === "string" ? body.beforeItemId : null;

  const items = await db.accountPlaylistItem.findMany({
    where: { playlistId: playlist.id },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  const from = items.findIndex((row) => row.id === itemId);
  if (from === -1) {
    return NextResponse.json({ error: "Item not found." }, { status: 404 });
  }
  const [moved] = items.splice(from, 1);
  const targetIndex = beforeItemId
    ? items.findIndex((row) => row.id === beforeItemId)
    : items.length;
  items.splice(targetIndex === -1 ? items.length : targetIndex, 0, moved);

  await db.$transaction(
    items.map((row, index) =>
      db.accountPlaylistItem.update({
        where: { id: row.id },
        data: { position: index },
      }),
    ),
  );
  const updated = await db.accountPlaylist.update({
    where: { id: playlist.id },
    data: { revision: { increment: 1 } },
  });
  const rows = await db.accountPlaylistItem.findMany({
    where: { playlistId: playlist.id },
    orderBy: { position: "asc" },
  });
  return NextResponse.json({
    playlist: {
      id: updated.id,
      title: updated.title,
      description: updated.description ?? undefined,
      isPublic: updated.isPublic,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      revision: updated.revision,
      ownerId: identity.accountId,
      owner: { id: identity.accountId, username: identity.username },
    },
    items: rows.map((row) => ({
      id: row.id,
      track: row.snapshot ? JSON.parse(row.snapshot) : undefined,
      position: row.position,
      addedAt: row.addedAt.toISOString(),
    })),
  });
}
