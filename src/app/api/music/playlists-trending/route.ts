import { NextRequest, NextResponse } from "next/server"
import { fetchTrendingPlaylists } from "@/lib/audius"
import { maintenanceGate } from "@/lib/maintenance";

export async function GET() {
  const gate = await maintenanceGate();
  if (gate) return gate;
  const collections = await fetchTrendingPlaylists(12)
  return NextResponse.json({ collections })
}
