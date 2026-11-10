import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/websiteAuth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; trackId: string }> };

/**
 * POST /api/library/playlists/[id]/tracks/[trackId] — add one track by id.
 * DELETE — remove every row for that track id.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const identity = await verifyAccessToken(bearer);
  if (!identity) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { id, trackId } = await params;
  const playlist = await db.accountPlaylist.findFirst({
    where: { id, accountId: identity.accountId },
  });
  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const track = (body?.track ?? body?.trackSnapshot ?? null) as {
    id?: string;
    title?: string;
    artists?: string;
    coverUrl?: string | null;
    durationMs?: number;
    source?: string;
  } | null;
  const title = track?.title?.trim();
  if (!title) {
    return NextResponse.json(
      { error: "track snapshot with title is required" },
      { status: 400 },
    );
  }
  const last = await db.accountPlaylistItem.findFirst({
    where: { playlistId: playlist.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const row = await db.accountPlaylistItem.upsert({
    where: {
      playlistId_trackId: { playlistId: playlist.id, trackId },
    },
    create: {
      playlistId: playlist.id,
      trackId,
      title: title.slice(0, 300),
      artist: String(track?.artists ?? "Unknown artist").slice(0, 300),
      artwork: track?.coverUrl ? String(track.coverUrl).slice(0, 100_000) : null,
      durationMs: Number.isFinite(track?.durationMs)
        ? Number(track?.durationMs)
        : 0,
      source: String(track?.source ?? "youtube").slice(0, 40),
      snapshot: JSON.stringify(track),
      position: (last?.position ?? -1) + 1,
    },
    update: {
      title: title.slice(0, 300),
      artist: String(track?.artists ?? "Unknown artist").slice(0, 300),
      snapshot: JSON.stringify(track),
    },
  });
  await db.accountPlaylist.update({
    where: { id: playlist.id },
    data: { revision: { increment: 1 } },
  });
  return NextResponse.json({
    id: row.id,
    track: row.snapshot ? JSON.parse(row.snapshot) : undefined,
    position: row.position,
    addedAt: row.addedAt.toISOString(),
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const identity = await verifyAccessToken(bearer);
  if (!identity) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { id, trackId } = await params;
  const playlist = await db.accountPlaylist.findFirst({
    where: { id, accountId: identity.accountId },
  });
  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
  }
  const removed = await db.accountPlaylistItem.deleteMany({
    where: { playlistId: playlist.id, trackId },
  });
  if (removed.count > 0) {
    await db.accountPlaylist.update({
      where: { id: playlist.id },
      data: { revision: { increment: 1 } },
    });
  }
  return NextResponse.json({ ok: true, removed: removed.count });
}
