import { NextRequest, NextResponse } from "next/server"
import { fetchTrending } from "@/lib/audius"
import { maintenanceGate } from "@/lib/maintenance";

export async function GET(req: NextRequest) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  const genre = req.nextUrl.searchParams.get("genre") ?? undefined
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 30) || 30, 100)
  const tracks = await fetchTrending(genre || undefined, limit)
  return NextResponse.json({ tracks })
}
