import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/websiteAuth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

interface TrackInput {
  id?: string;
  title?: string;
  artists?: string;
  artistId?: string | null;
  coverUrl?: string | null;
  durationMs?: number;
  source?: string;
}

function snapshotOf(track: unknown) {
  const t = (track ?? {}) as TrackInput;
  if (!t.id || !t.title) return null;
  return {
    trackId: String(t.id),
    source: String(t.source ?? "youtube").slice(0, 40),
    title: String(t.title).slice(0, 300),
    artist: String(t.artists ?? "Unknown artist").slice(0, 300),
    artistId: t.artistId ? String(t.artistId).slice(0, 120) : null,
    artwork: t.coverUrl ? String(t.coverUrl).slice(0, 100_000) : null,
    durationMs: Number.isFinite(t.durationMs) ? Number(t.durationMs) : 0,
    snapshot: JSON.stringify(track),
  };
}

async function owned(accountId: string, id: string) {
  return db.accountPlaylist.findFirst({ where: { id, accountId } });
}

async function nextPosition(playlistId: string): Promise<number> {
  const last = await db.accountPlaylistItem.findFirst({
    where: { playlistId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return (last?.position ?? -1) + 1;
}

/**
 * POST /api/library/playlists/[id]/tracks — append one track (body {track})
 * or a batch (body {tracks: [...]}, used by the import manager).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const identity = await verifyAccessToken(bearer);
  if (!identity) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { id } = await params;
  const playlist = await owned(identity.accountId, id);
  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const batch: unknown[] = Array.isArray(body?.tracks)
    ? body.tracks
    : body?.track
      ? [body.track]
      : body?.trackSnapshot
        ? [body.trackSnapshot]
        : [];
  const snaps = batch
    .map(snapshotOf)
    .filter((s): s is NonNullable<ReturnType<typeof snapshotOf>> => s !== null);
  if (snaps.length === 0) {
    return NextResponse.json(
      { error: "track (with id and title) is required" },
      { status: 400 },
    );
  }

  let position = await nextPosition(playlist.id);
  const created: {
    id: string;
    track?: unknown;
    position: number;
    addedAt: string;
  }[] = [];
  let added = 0;
  let rejected = 0;
  for (const snap of snaps) {
    try {
      const row = await db.accountPlaylistItem.create({
        data: { playlistId: playlist.id, position: position++, ...snap },
      });
      created.push({
        id: row.id,
        track: row.snapshot ? JSON.parse(row.snapshot) : undefined,
        position: row.position,
        addedAt: row.addedAt.toISOString(),
      });
      added++;
    } catch {
      // P2002 = already in the playlist
      rejected++;
    }
  }
  await db.accountPlaylist.update({
    where: { id: playlist.id },
    data: { revision: { increment: 1 } },
  });
  if (created.length === 1) return NextResponse.json(created[0]);
  return NextResponse.json({ items: created, added, rejected });
}
