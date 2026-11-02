/**
 * Website-port User Finder API — site owner only.
 *
 * Thin client over the website's own /api/userfinder route (same-origin
 * Next.js backend). The server enforces the jayzeyluna gate; this module
 * only carries the owner's access token and normalizes the response.
 */

import { refreshAuthSession } from "@/shared/api/auth-session";

export interface UserFinderProfile {
  username?: string;
  email: string | null;
  userId: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  accountCreatedAt: string | null;
  followersCount: number | null;
  followingCount: number | null;
  isPublic: boolean | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

export interface UserFinderSong {
  title: string;
  artist: string;
  artwork: string | null;
  duration: number;
  source: string;
  playedAt: string;
}

export interface UserFinderBan {
  type: string;
  reason: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface UserFinderResult {
  found: boolean;
  username: string;
  /** "upstream" = live from Liner's user directory, "cache" = website-only */
  profileSource?: "upstream" | "cache";
  profile?: UserFinderProfile | null;
  recentSongs?: UserFinderSong[];
  ban?: UserFinderBan | null;
  banHistoryCount?: number;
  lastIp?: { ip: string; updatedAt: string } | null;
  frozenIps?: { ip: string; createdAt: string }[];
  isAdminAccount?: boolean;
}

export type UserFinderErrorCode =
  | "unauthorized"
  | "forbidden"
  | "invalid_username"
  | "generic";

export class UserFinderError extends Error {
  constructor(
    public code: UserFinderErrorCode,
    public status: number,
  ) {
    super(`userfinder error: ${code} (${status})`);
    this.name = "UserFinderError";
  }
}

async function requestOnce(
  username: string,
  accessToken: string | null,
  timeoutMs: number,
): Promise<UserFinderResult> {
  const url = `/api/userfinder?username=${encodeURIComponent(username)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401) throw new UserFinderError("unauthorized", 401);
  if (res.status === 403) throw new UserFinderError("forbidden", 403);
  if (res.status === 400) throw new UserFinderError("invalid_username", 400);
  if (!res.ok) throw new UserFinderError("generic", res.status);
  const data = (await res.json()) as UserFinderResult;
  if (typeof data?.found !== "boolean") throw new UserFinderError("generic", 200);
  return data;
}

/**
 * Look up an account. One self-healing retry on 401: refresh the Liner
 * session once and try again — the website admin cookie can also vouch on
 * its own when the upstream session is dead (same model as moderation).
 */
export async function findUser(
  username: string,
  accessToken: string | null,
  timeoutMs = 15_000,
): Promise<UserFinderResult> {
  try {
    return await requestOnce(username, accessToken, timeoutMs);
  } catch (err) {
    if (err instanceof UserFinderError && err.code === "unauthorized") {
      const refreshed = await refreshAuthSession().catch(() => null);
      const nextToken = refreshed?.accessToken ?? accessToken;
      if (nextToken) {
        return requestOnce(username, nextToken, timeoutMs);
      }
    }
    throw err;
  }
}
