import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/websiteAuth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

interface SnapshotInput {
  id?: string;
  title?: string;
  artists?: string;
  artistId?: string | null;
  coverUrl?: string | null;
  durationMs?: number;
  source?: string;
}

function snapshotOf(track: unknown): {
  trackId: string;
  source: string;
  title: string;
  artist: string;
  artistId: string | null;
  artwork: string | null;
  durationMs: number;
  snapshot: string | null;
} | null {
  const t = (track ?? {}) as SnapshotInput;
  if (!t.id || !t.title) return null;
  return {
    trackId: String(t.id),
    source: String(t.source ?? "youtube").slice(0, 40),
    title: String(t.title).slice(0, 300),
    artist: String(t.artists ?? "Unknown artist").slice(0, 300),
    artistId: t.artistId ? String(t.artistId).slice(0, 120) : null,
    artwork: t.coverUrl ? String(t.coverUrl).slice(0, 100_000) : null,
    durationMs: Number.isFinite(t.durationMs) ? Number(t.durationMs) : 0,
    // keep the exact client snapshot so the liked-songs page round-trips losslessly
    snapshot: JSON.stringify(track),
  };
}

/** GET /api/library/tracks — liked songs page (newest first). */
export async function GET(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const identity = await verifyAccessToken(bearer);
  if (!identity) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Math.min(
    200,
    Math.max(1, Number(url.searchParams.get("limit")) || PAGE_SIZE),
  );
  const cursor = url.searchParams.get("cursor");
  const rows = await db.accountTrack.findMany({
    where: { accountId: identity.accountId },
    orderBy: { likedAt: "desc" },
    take: limit + 1,
    ...(cursor
      ? { skip: 1, cursor: { id: cursor } }
      : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return NextResponse.json({
    items: page.map((row) => ({
      track: row.snapshot ? JSON.parse(row.snapshot) : {
        id: row.trackId,
        title: row.title,
        artists: row.artist,
        artistId: row.artistId ?? undefined,
        coverUrl: row.artwork ?? undefined,
        durationMs: row.durationMs,
      },
      likedAt: row.likedAt.toISOString(),
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}

/** PUT /api/library/tracks — like a track (idempotent upsert). */
export async function PUT(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const identity = await verifyAccessToken(bearer);
  if (!identity) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const snap = snapshotOf(body?.track ?? body?.trackSnapshot);
  if (!snap) {
    return NextResponse.json(
      { error: "track.id and track.title are required" },
      { status: 400 },
    );
  }
  await db.accountTrack.upsert({
    where: {
      accountId_trackId: { accountId: identity.accountId, trackId: snap.trackId },
    },
    create: { accountId: identity.accountId, ...snap },
    update: { ...snap, likedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/library/tracks?trackId=… — unlike a track. */
export async function DELETE(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const identity = await verifyAccessToken(bearer);
  if (!identity) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const url = new URL(req.url);
  const trackId = url.searchParams.get("trackId");
  // DELETE with a JSON body is also accepted (some clients send it that way)
  if (!trackId) {
    const body = await req.json().catch(() => null);
    const fromBody = body?.trackId ?? body?.id;
    if (typeof fromBody !== "string") {
      return NextResponse.json(
        { error: "trackId is required" },
        { status: 400 },
      );
    }
    await db.accountTrack.deleteMany({
      where: { accountId: identity.accountId, trackId: fromBody },
    });
    return NextResponse.json({ ok: true });
  }
  await db.accountTrack.deleteMany({
    where: { accountId: identity.accountId, trackId },
  });
  return NextResponse.json({ ok: true });
}
