import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { maintenanceGate } from "@/lib/maintenance";

interface IncomingTrack {
  id: string
  source?: string
  title: string
  artist: string
  artistId?: string | null
  artwork?: string | null
  duration?: number
}

export async function GET() {
  const gate = await maintenanceGate();
  if (gate) return gate;
  const likes = await db.likedTrack.findMany({ orderBy: { createdAt: "desc" } })
  return NextResponse.json({ likes })
}

/** Toggle like state for a track; returns the resulting state. */
export async function POST(req: NextRequest) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  const body = await req.json().catch(() => null)
  const t: IncomingTrack | null = body?.track ?? null
  if (!t?.id || !t.title) {
    return NextResponse.json({ error: "track is required" }, { status: 400 })
  }

  const existing = await db.likedTrack.findUnique({ where: { trackId: String(t.id) } })
  if (existing) {
    await db.likedTrack.delete({ where: { trackId: String(t.id) } })
    return NextResponse.json({ liked: false })
  }

  await db.likedTrack.create({
    data: {
      trackId: String(t.id),
      source: t.source === "itunes" ? "itunes" : "audius",
      title: String(t.title).slice(0, 200),
      artist: String(t.artist ?? "Unknown").slice(0, 200),
      artistId: t.artistId ?? null,
      artwork: t.artwork ?? null,
      duration: Math.max(0, Math.round(Number(t.duration ?? 0))),
    },
  })
  return NextResponse.json({ liked: true }, { status: 201 })
}
