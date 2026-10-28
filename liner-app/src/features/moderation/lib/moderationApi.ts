/**
 * Website-port moderation API.
 *
 * Talks to the website port's own backend (same-origin Next.js routes), NOT
 * to api.tryliner.fun. The original desktop app has no such feature — bans
 * exist only on the website port and never touch the upstream Liner API.
 */

import { refreshAuthSession } from "@/shared/api/auth-session";

export type BanType = "normal" | "ip";

export interface BanInfo {
  username: string;
  type: BanType;
  reason: string | null;
  /** ISO timestamp of the ban creation moment. */
  createdAt: string;
  /** ISO timestamp when the ban lifts, or null for forever. */
  expiresAt: string | null;
  createdBy?: string;
  /** Network addresses frozen by this ban (ip-type bans only). */
  bannedIps?: string[];
  /**
   * Profile picture captured at ban time (from the live session), so the
   * banned wall keeps showing the account's face across refreshes even
   * after the session itself has been dropped.
   */
  avatarUrl?: string | null;
}

export interface BanCheckResult {
  banned: boolean;
  username?: string | null;
  type?: BanType | null;
  reason?: string | null;
  expiresAt?: string | null;
}

export type ModerationErrorCode =
  | "banned"
  | "unauthorized"
  | "forbidden"
  | "invalid_username"
  | "invalid_type"
  | "invalid_duration"
  | "cannot_ban_admin"
  | "not_banned"
  | "generic";

export class ModerationError extends Error {
  constructor(
    public code: ModerationErrorCode,
    public status: number,
  ) {
    super(`moderation error: ${code} (${status})`);
    this.name = "ModerationError";
  }
}

export interface AddBanInput {
  username: string;
  type: BanType;
  /** Hours until the ban lifts, or null for forever. */
  durationHours: number | null;
  reason?: string | null;
}

/** Liner username rules (matches the upstream registration validator). */
export const LINER_USERNAME_RE = /^[a-z0-9_]{3,30}$/;

export function normalizeUsername(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const username = input.trim().toLowerCase();
  return LINER_USERNAME_RE.test(username) ? username : null;
}

/** True when the client-side ban probe says this visitor is blocked. */
export function isBannedResult(result: BanCheckResult | null): boolean {
  return !!result && result.banned === true;
}

/** Probe the website backend: is this account / this network blocked? */
export async function checkBan(
  username: string | null | undefined,
  accessToken?: string | null,
  timeoutMs = 8_000,
): Promise<BanCheckResult> {
  const res = await fetch("/api/moderation/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: typeof username === "string" ? username : undefined,
      accessToken: accessToken || undefined,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new ModerationError("generic", res.status);
  const data = (await res.json()) as BanCheckResult;
  if (typeof data?.banned !== "boolean") throw new ModerationError("generic", res.status);
  return data;
}

async function adminRequestOnce<T>(
  init: { method: "GET" | "POST" | "DELETE"; body?: unknown },
  accessToken: string | null,
  timeoutMs: number,
): Promise<T> {
  const res = await fetch("/api/moderation/bans", {
    method: init.method,
    headers: {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    if (res.status === 401) throw new ModerationError("unauthorized", 401);
    if (res.status === 403) throw new ModerationError("forbidden", 403);
    let code: ModerationErrorCode = "generic";
    try {
      const data = (await res.json()) as { error?: string };
      if (
        data?.error === "invalid_username" ||
        data?.error === "invalid_type" ||
        data?.error === "invalid_duration" ||
        data?.error === "cannot_ban_admin" ||
        data?.error === "not_banned"
      ) {
        code = data.error;
      }
    } catch {
      // keep generic
    }
    throw new ModerationError(code, res.status);
  }
  return (await res.json()) as T;
}

/**
 * Admin request with the same self-healing the rest of the app gets from
 * executeRequest: if the server rejects the token (401 — stale access token,
 * clock skew, missing expiry metadata, one transient refresh failure), force
 * exactly one session refresh and retry before surfacing "session expired"
 * to the site owner.
 *
 * The retry runs even when the refresh produces nothing: the request is
 * same-origin, so the website admin cookie (issued by the server on any
 * previously verified owner session) rides along and can vouch for the
 * browser on its own. `accessToken` may be null — the website cookie is
 * then the only credential, which is exactly the "Liner session died but
 * the owner is still the owner" state this exists to rescue.
 */
async function adminRequest<T>(
  init: { method: "GET" | "POST" | "DELETE"; body?: unknown },
  accessToken: string | null,
  timeoutMs: number,
): Promise<T> {
  try {
    return await adminRequestOnce<T>(init, accessToken, timeoutMs);
  } catch (err) {
    if (err instanceof ModerationError && err.code === "unauthorized") {
      const refreshed = await refreshAuthSession().catch(() => null);
      const nextToken = refreshed?.accessToken ?? accessToken;
      if (nextToken) {
        return adminRequestOnce<T>(init, nextToken, timeoutMs);
      }
    }
    throw err;
  }
}

/** All active bans (site owner only — the token is verified server-side). */
export async function listBans(
  accessToken: string | null,
  timeoutMs = 15_000,
): Promise<BanInfo[]> {
  const data = await adminRequest<{ bans: unknown }>(
    { method: "GET" },
    accessToken,
    timeoutMs,
  );
  if (!Array.isArray(data?.bans)) return [];
  return data.bans
    .filter(
      (row): row is BanInfo =>
        !!row &&
        typeof (row as BanInfo).username === "string" &&
        ((row as BanInfo).type === "normal" || (row as BanInfo).type === "ip"),
    )
    .map((row) => ({
      ...row,
      reason: typeof row.reason === "string" ? row.reason : null,
      expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : null,
      bannedIps: Array.isArray(row.bannedIps) ? row.bannedIps : [],
    }));
}

/** Ban one account (site owner only). Returns the stored ban. */
export async function addBan(
  input: AddBanInput,
  accessToken: string | null,
  timeoutMs = 15_000,
): Promise<BanInfo> {
  const data = await adminRequest<{ ban: BanInfo }>(
    {
      method: "POST",
      body: {
        username: input.username,
        type: input.type,
        durationHours: input.durationHours,
        reason: input.reason ?? null,
      },
    },
    accessToken,
    timeoutMs,
  );
  if (!data?.ban || typeof data.ban.username !== "string") {
    throw new ModerationError("generic", 200);
  }
  return data.ban;
}

/** Lift a ban by Liner username (site owner only). */
export async function removeBan(
  username: string,
  accessToken: string | null,
  timeoutMs = 15_000,
): Promise<void> {
  await adminRequest<{ ok: boolean }>(
    { method: "DELETE", body: { username } },
    accessToken,
    timeoutMs,
  );
}

/** "Forever", "3d 4h left", "42m left" — for ban rows and the banned screen. */
export function formatBanRemaining(
  expiresAt: string | null,
  now: number = Date.now(),
): { text: string; forever: boolean } {
  if (!expiresAt) return { text: "Forever", forever: true };
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(end)) return { text: "Forever", forever: true };
  const ms = end - now;
  if (ms <= 0) return { text: "Expired", forever: false };
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) return { text: `${days}d ${hours % 24}h left`, forever: false };
  if (hours >= 1) return { text: `${hours}h ${minutes % 60}m left`, forever: false };
  return { text: `${minutes}m left`, forever: false };
}

/** Duration picker presets (hours; "custom" reveals a free hours input). */
export const BAN_DURATION_PRESETS: { value: string; hours: number | null }[] = [
  { value: "forever", hours: null },
  { value: "1", hours: 1 },
  { value: "6", hours: 6 },
  { value: "12", hours: 12 },
  { value: "24", hours: 24 },
  { value: "72", hours: 72 },
  { value: "168", hours: 168 },
  { value: "720", hours: 720 },
  { value: "custom", hours: -1 },
];
