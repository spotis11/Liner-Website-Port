/**
 * Liner Pro grants API (site owner only).
 *
 * Talks to the website port's own backend (/api/moderation/pro — same admin
 * gate as the bans API). The owner's own account is Pro forever server-side
 * and cannot be revoked; everyone else is granted/revoked here by Liner
 * username. No payment anywhere — Pro is approval-only.
 */

import {
  adminRequest,
  normalizeUsername,
  ModerationError,
} from "./moderationApi";

export interface ProUserInfo {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  /** true for the site owner's own account (permanent Pro). */
  isOwner: boolean;
  grantedBy: string | null;
  grantedAt: string | null;
}

export interface ProListResult {
  users: ProUserInfo[];
  owner: string;
}

/** All Pro accounts (site owner only — verified server-side). */
export async function listProUsers(
  accessToken: string | null,
  timeoutMs = 15_000,
): Promise<ProListResult> {
  const data = await adminRequest<{ users: unknown; owner: unknown }>(
    { method: "GET" },
    accessToken,
    timeoutMs,
    "/api/moderation/pro",
  );
  const users = Array.isArray(data?.users)
    ? data.users.filter(
        (row): row is ProUserInfo =>
          !!row && typeof (row as ProUserInfo).username === "string",
      )
    : [];
  return {
    users,
    owner:
      typeof data?.owner === "string" ? data.owner : "jayzeyluna",
  };
}

/** Grant Liner Pro to an account by Liner username (site owner only). */
export async function grantProUser(
  username: string,
  accessToken: string | null,
  timeoutMs = 15_000,
): Promise<ProListResult> {
  const clean = normalizeUsername(username);
  if (!clean) throw new ModerationError("invalid_username", 400);
  const data = await adminRequest<{ ok: boolean; users: ProUserInfo[] }>(
    { method: "POST", body: { username: clean } },
    accessToken,
    timeoutMs,
    "/api/moderation/pro",
  );
  return {
    users: Array.isArray(data?.users) ? data.users : [],
    owner: "jayzeyluna",
  };
}

/** Revoke Liner Pro (the owner's own account cannot be revoked). */
export async function revokeProUser(
  username: string,
  accessToken: string | null,
  timeoutMs = 15_000,
): Promise<ProListResult> {
  const clean = normalizeUsername(username);
  if (!clean) throw new ModerationError("invalid_username", 400);
  const data = await adminRequest<{ ok: boolean; users: ProUserInfo[] }>(
    { method: "DELETE", body: { username: clean } },
    accessToken,
    timeoutMs,
    "/api/moderation/pro",
  );
  return {
    users: Array.isArray(data?.users) ? data.users : [],
    owner: "jayzeyluna",
  };
}
