import { NextRequest } from "next/server"
import { resolveItunesPreview } from "@/lib/itunes"
import { maintenanceGate } from "@/lib/maintenance";

export const dynamic = "force-dynamic"

const APP_NAME = "LyraWeb"

async function resolveUpstream(idParam: string): Promise<string | null> {
  const sep = idParam.indexOf(":")
  const source = sep === -1 ? "audius" : idParam.slice(0, sep)
  const id = sep === -1 ? idParam : idParam.slice(sep + 1)
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return null

  if (source === "audius") {
    return `https://discoveryprovider.audius.co/v1/tracks/${encodeURIComponent(id)}/stream?app_name=${APP_NAME}`
  }
  if (source === "itunes") {
    return resolveItunesPreview(id)
  }
  return null
}

/**
 * Streams audio with Range passthrough so the <audio> element can seek.
 * Ids are namespaced as `<source>:<id>`.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  const { id } = await ctx.params
  const upstream = await resolveUpstream(decodeURIComponent(id))
  if (!upstream) return new Response("Bad track id", { status: 400 })

  const range = req.headers.get("range")
  const headers: HeadersInit = {}
  if (range) headers["Range"] = range

  try {
    const res = await fetch(upstream, {
      headers,
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok || !res.body) {
      return new Response("Upstream error", { status: 502 })
    }

    const out = new Headers()
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const v = res.headers.get(h)
      if (v) out.set(h, v)
    }
    if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes")
    if (!out.has("content-type")) out.set("content-type", "audio/mpeg")
    out.set("cache-control", "public, max-age=3600")

    return new Response(res.body, { status: res.status, headers: out })
  } catch {
    return new Response("Stream failed", { status: 504 })
  }
}
