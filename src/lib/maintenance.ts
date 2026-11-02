import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Website-port maintenance wall.
 *
 * A single server-side switch that, when enabled, puts the whole website
 * into a forced maintenance state: the SPA renders a full-screen
 * "Currently on Maintenance!" page instead of the app (sign-in included),
 * and the playback/data API routes answer 503 so nothing can be listened
 * to or synced even by bypassing the UI. Mirrors the ban system's trust
 * model: the website backend is the only authority, the client mirrors
 * the wall so it survives normal and hard refreshes.
 *
 * State lives in the SystemKey table (key "web_maintenance_v1") so it
 * survives restarts and republishes. Reads are cached in memory for a few
 * seconds so gating hot routes stays cheap.
 */

export const MAINTENANCE_KEY = "web_maintenance_v1";

export interface MaintenanceState {
  enabled: boolean;
  /** Human-readable reasons shown on the maintenance screen. */
  reasons: string[];
  updatedAt: string;
}

/** Default reasons when the owner enables maintenance without custom ones. */
export const DEFAULT_MAINTENANCE_REASONS: string[] = [
  "Sign-in is temporarily unavailable",
  "Music playback is temporarily disabled",
  "We're performing server maintenance and upgrades",
];

const EMPTY_STATE: MaintenanceState = {
  enabled: false,
  reasons: [],
  updatedAt: new Date(0).toISOString(),
};

let cache: { state: MaintenanceState; at: number } | null = null;
const CACHE_MS = 3_000;

function parseState(raw: string | null | undefined): MaintenanceState {
  if (!raw) return EMPTY_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<MaintenanceState> | null;
    if (!parsed || typeof parsed !== "object") return EMPTY_STATE;
    return {
      enabled: parsed.enabled === true,
      reasons: Array.isArray(parsed.reasons)
        ? parsed.reasons.filter((r): r is string => typeof r === "string" && r.trim().length > 0).slice(0, 8)
        : [],
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return EMPTY_STATE;
  }
}

/** Read the current maintenance state (3s in-memory cache). */
export async function getMaintenance(): Promise<MaintenanceState> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.state;
  let state: MaintenanceState;
  try {
    const row = await db.systemKey.findUnique({ where: { key: MAINTENANCE_KEY } });
    state = parseState(row?.value ?? null);
  } catch {
    // db hiccup must never take the site down — treat as "not maintaining"
    state = EMPTY_STATE;
  }
  cache = { state, at: Date.now() };
  return state;
}

/** Enable/disable maintenance; empty reasons fall back to the defaults. */
export async function setMaintenance(
  enabled: boolean,
  reasons?: string[],
): Promise<MaintenanceState> {
  const cleaned = (reasons ?? [])
    .map((r) => String(r).trim())
    .filter((r) => r.length > 0)
    .slice(0, 8);
  const state: MaintenanceState = {
    enabled: enabled === true,
    reasons: enabled ? (cleaned.length > 0 ? cleaned : DEFAULT_MAINTENANCE_REASONS) : [],
    updatedAt: new Date().toISOString(),
  };
  const value = JSON.stringify(state);
  await db.systemKey.upsert({
    where: { key: MAINTENANCE_KEY },
    update: { value },
    create: { key: MAINTENANCE_KEY, value },
  });
  cache = { state, at: Date.now() };
  return state;
}

/**
 * Route gate: returns a 503 response when maintenance is enabled, or null
 * when the request may proceed. Drop this at the top of every handler on
 * the playback/data plane (music, media, yt/sc proxies, likes, playlists,
 * history, fetch...). Admin and status routes stay ungated so the owner
 * can always turn maintenance off again.
 */
export async function maintenanceGate(): Promise<NextResponse | null> {
  const state = await getMaintenance();
  if (!state.enabled) return null;
  return NextResponse.json(
    { error: "maintenance", maintenance: true, reasons: state.reasons },
    { status: 503, headers: { "retry-after": "120" } },
  );
}
