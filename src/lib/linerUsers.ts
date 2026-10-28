import { LINER_PRIMARY_API } from "./announcements";

/**
 * Upstream Liner user-directory client (server-side).
 *
 * The desktop app (tryliner/desktop) ships a social layer against
 * api.tryliner.fun:
 *   GET /v1/users/:idOrUsername        -> UserProfile
 *   GET /v1/users/search?q=<query>     -> UserProfile[]
 *   GET /v1/users/:idOrUsername/history?limit=&cursor= -> PlaybackHistoryResponse
 * These routes always carry the signed-in user's Bearer token (unauthenticated
 * probes 404 — the API hides them from anonymous callers), so this client
 * forwards the SITE OWNER's own token. The owner sees exactly what they
 * could see about any account in the desktop app itself.
 *
 * Every helper returns null on 404/401/error instead of throwing — an absent
 * upstream directory must degrade to the website's own cache, never break
 * the lookup.
 */

/** same hardening as every other upstream probe: browser-like UA + timeout */
const LINER_USERS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface UpstreamUser {
  id: string;
  email?: string | null;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  isPublic?: boolean;
  followersCount?: number;
  followingCount?: number;
  createdAt?: string;
}

export interface UpstreamHistoryTrack {
  id: string;
  title: string;
  artists?: Array<{ id?: string; name?: string }>;
  durationMs?: number;
  cover?: { url?: string } | Record<string, unknown> | null;
}

export interface UpstreamHistoryItem {
  track?: UpstreamHistoryTrack;
  listenedAt?: string;
}

const TIMEOUT_MS = 8_000;

async function upstreamGet(
  path: string,
  accessToken: string,
): Promise<{ status: number; json: unknown } | null> {
  const call = (): Promise<Response | null> =>
    fetch(`${LINER_PRIMARY_API}${path}`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
        "user-agent": LINER_USERS_UA,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => null);

  let res = await call();
  // one retry on transport error / upstream 5xx — same policy as the
  // moderation and announcement probes
  if (!res || res.status >= 500) {
    res = await call();
  }
  if (!res || res.status >= 500) return null;
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/** GET /v1/users/:idOrUsername — full public profile of any account. */
export async function fetchUpstreamUser(
  idOrUsername: string,
  accessToken: string,
): Promise<UpstreamUser | null> {
  if (!accessToken) return null;
  const res = await upstreamGet(
    `/v1/users/${encodeURIComponent(idOrUsername)}`,
    accessToken,
  );
  if (!res || res.status !== 200) return null;
  const user = (res.json ?? {}) as UpstreamUser;
  return typeof user?.id === "string" && user.id ? user : null;
}

/**
 * GET /v1/users/search?q= — directory search. Returns the raw result list
 * (may be empty) or null when the route is unavailable.
 */
export async function searchUpstreamUsers(
  query: string,
  accessToken: string,
): Promise<UpstreamUser[] | null> {
  if (!accessToken) return null;
  const res = await upstreamGet(
    `/v1/users/search?q=${encodeURIComponent(query)}`,
    accessToken,
  );
  if (!res || res.status !== 200) return null;
  const list = res.json;
  return Array.isArray(list) ? (list as UpstreamUser[]) : null;
}

/**
 * Resolve a username (or user id) to a full profile: exact lookup first,
 * then directory search with exact -> prefix -> contains preference.
 */
export async function resolveUpstreamUser(
  idOrUsername: string,
  accessToken: string,
): Promise<UpstreamUser | null> {
  const exact = await fetchUpstreamUser(idOrUsername, accessToken);
  if (exact) return exact;

  const needle = idOrUsername.trim().toLowerCase();
  const results = await searchUpstreamUsers(needle, accessToken);
  if (!results || results.length === 0) return null;
  const byUsername = (u: UpstreamUser) =>
    (u.username ?? "").trim().toLowerCase();
  return (
    results.find((u) => byUsername(u) === needle) ??
    results.find((u) => byUsername(u).startsWith(needle)) ??
    results.find((u) => byUsername(u).includes(needle)) ??
    null
  );
}

/** GET /v1/users/:idOrUsername/history — the account's Liner play history. */
export async function fetchUpstreamUserHistory(
  idOrUsername: string,
  accessToken: string,
  limit = 15,
): Promise<UpstreamHistoryItem[] | null> {
  if (!accessToken) return null;
  const res = await upstreamGet(
    `/v1/users/${encodeURIComponent(idOrUsername)}/history?limit=${limit}`,
    accessToken,
  );
  if (!res || res.status !== 200) return null;
  const body = res.json as { items?: UpstreamHistoryItem[] } | null;
  return Array.isArray(body?.items) ? body.items : null;
}

/** Flatten an upstream history item into the User Finder song shape. */
export function upstreamHistoryToSong(
  item: UpstreamHistoryItem,
): {
  title: string;
  artist: string;
  artwork: string | null;
  duration: number;
  source: string;
  playedAt: string;
} | null {
  const track = item?.track;
  if (!track || typeof track.title !== "string" || !track.title) return null;
  const artist = Array.isArray(track.artists)
    ? track.artists
        .map((a) => (typeof a?.name === "string" ? a.name : ""))
        .filter(Boolean)
        .join(", ")
    : "";
  const cover = track.cover as { url?: unknown } | null | undefined;
  const artwork =
    cover && typeof cover.url === "string" && cover.url ? cover.url : null;
  const playedAt =
    typeof item.listenedAt === "string" && item.listenedAt
      ? item.listenedAt
      : new Date(0).toISOString();
  return {
    title: track.title,
    artist: artist || "—",
    artwork,
    duration: typeof track.durationMs === "number" ? track.durationMs / 1000 : 0,
    source: "liner",
    playedAt,
  };
}
