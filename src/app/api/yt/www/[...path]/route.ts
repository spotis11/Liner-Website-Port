// Liner web port: Innertube proxy (TV / visionOS / Android VR origin).
// Forwards /api/yt/www/<endpoint> to https://www.youtube.com/youtubei/<endpoint>.
//
// The desktop sends every playback-profile player request (TVHTML5,
// VISIONOS, ANDROID_VR — including the account-authorized one that carries the
// user's YouTube OAuth token) to www.youtube.com. YouTube only trusts those
// client contexts on the host a real client of that class uses, so flattening
// them onto music.youtube.com made every uncached-track playback fail ("Sign
// in to confirm you're not a bot" / unavailable). This route restores the
// host the desktop uses. Shared implementation: @/lib/innertube-proxy.

import { NextRequest } from "next/server";
import { YT_UPSTREAM_WWW } from "@/lib/liner-proxy";
import { OPTIONS, proxyInnertube } from "@/lib/innertube-proxy";
import { maintenanceGate } from "@/lib/maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  return proxyInnertube(request, YT_UPSTREAM_WWW, "/api/yt/www/");
}

export async function GET(request: NextRequest) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  return proxyInnertube(request, YT_UPSTREAM_WWW, "/api/yt/www/");
}

export { OPTIONS };
