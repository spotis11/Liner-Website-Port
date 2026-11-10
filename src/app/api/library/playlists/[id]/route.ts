import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/websiteAuth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function ownedPlaylist(accountId: string, id: string) {
  return db.accountPlaylist.findFirst({
    where: { id, accountId },
    include: { items: { orderBy: { position: "asc" } } },
  });
}

function itemToTrack(row: {
  trackId: string;
  source: string;
  title: string;
  artist: string;
  artistId: string | null;
  artwork: string | null;
  durationMs: number;
  snapshot: string | null;
}) {
  return row.snapshot
    ? JSON.parse(row.snapshot)
    : {
        id: row.trackId,
        title: row.title,
        artists: row.artist,
        coverUrl: row.artwork ?? undefined,
        durationMs: row.durationMs,
        source: row.source,
      };
}

/** GET /api/library/playlists/[id] — full playlist + items. */
export async function GET(req: NextRequest, { params }: Params) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const identity = await verifyAccessToken(bearer);
  if (!identity) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { id } = await params;
  const playlist = await ownedPlaylist(identity.accountId, id);
  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
  }
  const durationMs = playlist.items.reduce(
    (sum, item) => sum + item.durationMs,
    0,
  );
  return NextResponse.json({
    playlist: {
      id: playlist.id,
      title: playlist.title,
      description: playlist.description ?? undefined,
      isPublic: playlist.isPublic,
      createdAt: playlist.createdAt.toISOString(),
      updatedAt: playlist.updatedAt.toISOString(),
      revision: playlist.revision,
      ownerId: identity.accountId,
      owner: { id: identity.accountId, username: identity.username },
    },
    items: playlist.items.map((item) => ({
      id: item.id,
      track: itemToTrack(item),
      position: item.position,
      addedAt: item.addedAt.toISOString(),
    })),
    trackCount: playlist.items.length,
    durationMs,
    partial: false,
  });
}

/** PATCH /api/library/playlists/[id] — rename / re-describe / publish. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const identity = await verifyAccessToken(bearer);
  if (!identity) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { id } = await params;
  const existing = await ownedPlaylist(identity.accountId, id);
  if (!existing) {
    return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const data: Record<string, string | boolean | number> = {};
  if (typeof body?.title === "string" && body.title.trim()) {
    data.title = body.title.trim().slice(0, 120);
  }
  if (typeof body?.description === "string" || body?.description === null) {
    data.description =
      typeof body.description === "string"
        ? body.description.slice(0, 500)
        : null;
  }
  if (typeof body?.isPublic === "boolean") data.isPublic = body.isPublic;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  data.revision = existing.revision + 1;
  const playlist = await db.accountPlaylist.update({
    where: { id: existing.id },
    data,
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
  });
}

/** DELETE /api/library/playlists/[id] — drop the playlist and its rows. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const identity = await verifyAccessToken(bearer);
  if (!identity) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { id } = await params;
  const existing = await ownedPlaylist(identity.accountId, id);
  if (!existing) {
    return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
  }
  await db.accountPlaylist.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}
