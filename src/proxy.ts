import { NextRequest, NextResponse } from "next/server";
import { getMaintenance } from "@/lib/maintenance";
import { renderMaintenancePage } from "@/lib/maintenancePage";

/**
 * Server-side maintenance wall (the hard gate).
 *
 * The website-port already has three maintenance layers:
 *   1. the data plane — every playback/data route answers 503 via
 *      `maintenanceGate()` (src/lib/maintenance.ts),
 *   2. the client mirror — the SPA probes /api/maintenance on boot and
 *      every 30s and covers itself with MaintenanceScreen,
 *   3. THIS file — the server-side wall for the HTML plane itself.
 *
 * Layer 3 exists because 1+2 are only airtight once the SPA has loaded:
 * a stale/cached bundle could boot before its mirror raises the wall, and
 * the service worker can serve a cached shell. When maintenance is enabled
 * this proxy answers EVERY non-API request (/, /login, /liner,
 * /liner/index.html, every deep link and asset path) with the standalone
 * 503 maintenance page BEFORE any Liner code, rewrite or service-worker
 * fill can run. No app shell, no sign-in form, no player, no bypass:
 * normal refresh, hard refresh and deep links all land on the wall.
 *
 * The wall shares the same SystemKey-backed switch as the other layers
 * (POST /api/maintenance, owner-only), so one toggle controls everything.
 * Fail-open on internal errors: the wall must never take the site down by
 * itself (a broken gate would be worse than no gate).
 */

export async function proxy(_req: NextRequest) {
  try {
    const state = await getMaintenance();
    if (!state.enabled) return NextResponse.next();

    return new NextResponse(renderMaintenancePage(state), {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
        pragma: "no-cache",
        "retry-after": "300",
      },
    });
  } catch {
    // Never let the gate itself break the site — fail open.
    return NextResponse.next();
  }
}

/**
 * Match every route EXCEPT:
 *  - /api/*            → gated per-route by maintenanceGate(); /api/health
 *                        (platform liveness) and /api/maintenance (the
 *                        switch + the wall's own release probe) must stay up
 *  - /_next/*          → Next.js internals (the SPA is served from /liner)
 *  - /favicon.ico      → cosmetic; keeps the Liner tab icon during work
 */
export const config = {
  matcher: ["/((?!api(?:/|$)|_next/|favicon\\.ico).*)"],
};
