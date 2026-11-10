import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/websiteAuth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; itemId: string }> };

/**
 * DELETE /api/library/playlists/[id]/items/[itemId] — remove one row (by row
 * id) and close the gap by renumbering the rest.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
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
  const removed = await db.accountPlaylistItem.deleteMany({
    where: { id: itemId, playlistId: playlist.id },
  });
  if (removed.count === 0) {
    return NextResponse.json({ error: "Item not found." }, { status: 404 });
  }
  const rest = await db.accountPlaylistItem.findMany({
    where: { playlistId: playlist.id },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  await db.$transaction(
    rest.map((row, index) =>
      db.accountPlaylistItem.update({
        where: { id: row.id },
        data: { position: index },
      }),
    ),
  );
  await db.accountPlaylist.update({
    where: { id: playlist.id },
    data: { revision: { increment: 1 } },
  });
  return NextResponse.json({ ok: true });
}
