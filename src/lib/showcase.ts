/**
 * Website Showcase — the "randomize website" mode.
 *
 * A single server-side switch that, when enabled, makes every visitor's
 * client scramble the website's name (browser tab title, login wordmark)
 * with random letters every few milliseconds and cover the address bar
 * down to the bare domain (history.replaceState — the SPA keeps running,
 * and a refresh on the covered "/" URL just boots the site again).
 * Purely cosmetic and fun — sign-in, playback and data APIs are untouched.
 * Dedicated to @jayzeyluna.
 *
 * State lives in the SystemKey table (key "web_showcase_v1") so it survives
 * restarts and republishes, exactly like the maintenance switch. Reads are
 * cached in memory for a few seconds so the public probe stays cheap even
 * with many open tabs polling it.
 */

import { db } from "@/lib/db";

export const SHOWCASE_KEY = "web_showcase_v1";

export interface ShowcaseState {
  enabled: boolean;
  updatedAt: string;
}

const EMPTY_STATE: ShowcaseState = {
  enabled: false,
  updatedAt: new Date(0).toISOString(),
};

let cache: { state: ShowcaseState; at: number } | null = null;
const CACHE_MS = 3_000;

function parseState(raw: string | null | undefined): ShowcaseState {
  if (!raw) return EMPTY_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<ShowcaseState> | null;
    if (!parsed || typeof parsed !== "object") return EMPTY_STATE;
    return {
      enabled: parsed.enabled === true,
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date(0).toISOString(),
    };
  } catch {
    return EMPTY_STATE;
  }
}

/** Read the current showcase state (3s in-memory cache). */
export async function getShowcase(): Promise<ShowcaseState> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.state;
  let state: ShowcaseState;
  try {
    const row = await db.systemKey.findUnique({ where: { key: SHOWCASE_KEY } });
    state = parseState(row?.value ?? null);
  } catch {
    // a db hiccup must never break the site — treat as "not showcasing"
    state = EMPTY_STATE;
  }
  cache = { state, at: Date.now() };
  return state;
}

/** Enable/disable the showcase mode. */
export async function setShowcase(enabled: boolean): Promise<ShowcaseState> {
  const state: ShowcaseState = {
    enabled: enabled === true,
    updatedAt: new Date().toISOString(),
  };
  const value = JSON.stringify(state);
  await db.systemKey.upsert({
    where: { key: SHOWCASE_KEY },
    update: { value },
    create: { key: SHOWCASE_KEY, value },
  });
  cache = { state, at: Date.now() };
  return state;
}
