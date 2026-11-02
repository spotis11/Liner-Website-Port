import { NextRequest, NextResponse } from "next/server"
import { fetchTrack } from "@/lib/audius"
import { maintenanceGate } from "@/lib/maintenance";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  const { id } = await ctx.params
  const track = await fetchTrack(id)
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 })
  return NextResponse.json({ track })
}
