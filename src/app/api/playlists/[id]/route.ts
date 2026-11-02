import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { maintenanceGate } from "@/lib/maintenance";

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  const { id } = await ctx.params
  const playlist = await db.playlist.findUnique({
    where: { id },
    include: { tracks: { orderBy: { position: "asc" } } },
  })
  if (!playlist) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ playlist })
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  const name = typeof body?.name === "string" ? body.name.trim() : ""
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 })
  const playlist = await db.playlist.update({
    where: { id },
    data: { name: name.slice(0, 80) },
  })
  return NextResponse.json({ playlist })
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  const { id } = await ctx.params
  await db.playlist.deleteMany({ where: { id } })
  return NextResponse.json({ ok: true })
}
