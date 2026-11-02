import { NextResponse } from "next/server"
import { fetchUnderground } from "@/lib/audius"
import { maintenanceGate } from "@/lib/maintenance";

export async function GET() {
  const gate = await maintenanceGate();
  if (gate) return gate;
  const tracks = await fetchUnderground(20)
  return NextResponse.json({ tracks })
}
