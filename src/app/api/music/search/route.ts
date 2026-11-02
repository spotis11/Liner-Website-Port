import { NextRequest, NextResponse } from "next/server"
import { searchTracks, searchArtists } from "@/lib/audius"
import { searchItunesTracks } from "@/lib/itunes"
import { maintenanceGate } from "@/lib/maintenance";

export async function GET(req: NextRequest) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim()
  if (!q) {
    return NextResponse.json({ tracks: [], artists: [], mainstream: [] })
  }
  const [tracks, artists, mainstream] = await Promise.all([
    searchTracks(q, 24),
    searchArtists(q, 10),
    searchItunesTracks(q, 10),
  ])
  return NextResponse.json({ tracks, artists, mainstream })
}
