// Liner Pro — the website port's own Pro tier bookkeeping.
//
// The site owner (Liner username jayzeyluna) holds Liner Pro forever by
// definition: the code-level owner check below always answers true for that
// username, so no deploy, wipe or database reset can ever take it away
// (the boot sweep additionally re-flags the row so the badge survives even
// mirror restores that predate this feature). Everyone else gets Pro by an
// explicit owner grant from the moderation panel — no payment, approval-only
// (DM thearchyexpunged on Discord, per the Pro tab).
//
// Grants live on the Account row (isPro / proGrantedBy / proGrantedAt) and
// therefore ride the same deploy-time database mirror as every other
// account field.

import { db } from "@/lib/db";
import { ANNOUNCEMENT_ADMIN_USERNAME } from "@/lib/announcements";

/** The owner's Liner Pro is permanent — enforced here, not just in the db. */
export const PRO_OWNER_USERNAME = ANNOUNCEMENT_ADMIN_USERNAME;

/** Liner username rules (matches the upstream registration validator). */
const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

export function normalizeProUsername(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const username = input.trim().toLowerCase();
  return USERNAME_RE.test(username) ? username : null;
}

/** True when this account must always show Liner Pro. */
export function isOwnerPro(username: string | null | undefined): boolean {
  return typeof username === "string" && username === PRO_OWNER_USERNAME;
}

export interface ProUserDTO {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isOwner: boolean;
  grantedBy: string | null;
  grantedAt: string | null;
}

/**
 * Re-flag the owner's account on boot (idempotent, single-flight). A wiped
 * or mirrored-over database gets the owner's Pro back the moment the server
 * comes up — "activated forever".
 */
let ownerSweep: Promise<void> | null = null;
export function ensureOwnerPro(): Promise<void> {
  ownerSweep ??= (async () => {
    try {
      await db.account.updateMany({
        where: { username: PRO_OWNER_USERNAME, isPro: false },
        data: {
          isPro: true,
          proGrantedBy: "system",
          proGrantedAt: new Date(),
        },
      });
    } catch (err) {
      console.warn("[pro] owner sweep failed:", err);
      // allow a retry on the next boot / next call
      ownerSweep = null;
    }
  })();
  return ownerSweep;
}

export async function listProUsers(): Promise<ProUserDTO[]> {
  const rows = await db.account.findMany({
    where: { isPro: true },
    select: {
      username: true,
      displayName: true,
      avatarUrl: true,
      proGrantedBy: true,
      proGrantedAt: true,
      isGuest: true,
    },
    orderBy: { proGrantedAt: "desc" },
  });
  // The owner always lists, even if a mirror restore dropped the flag.
  const ownerMissing = !rows.some(
    (row) => row.username === PRO_OWNER_USERNAME,
  );
  if (ownerMissing) {
    const owner = await db.account.findUnique({
      where: { username: PRO_OWNER_USERNAME },
      select: {
        username: true,
        displayName: true,
        avatarUrl: true,
        proGrantedBy: true,
        proGrantedAt: true,
        isGuest: true,
      },
    });
    if (owner) rows.unshift({ ...owner, isPro: true } as never);
  }
  return rows.map((row) => ({
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl ?? null,
    isOwner: row.username === PRO_OWNER_USERNAME,
    grantedBy: row.proGrantedBy ?? (row.username === PRO_OWNER_USERNAME ? "system" : null),
    grantedAt: row.proGrantedAt ? row.proGrantedAt.toISOString() : null,
  }));
}

export type ProGrantResult =
  | { ok: true; username: string }
  | { ok: false; error: "invalid_username" | "not_found" };

export async function grantPro(
  username: string,
  grantedBy: string,
): Promise<ProGrantResult> {
  const account = await db.account.findUnique({
    where: { username },
    select: { id: true },
  });
  if (!account) return { ok: false, error: "not_found" };
  await db.account.update({
    where: { username },
    data: { isPro: true, proGrantedBy: grantedBy, proGrantedAt: new Date() },
  });
  return { ok: true, username };
}

export type ProRevokeResult =
  | { ok: true; username: string }
  | { ok: false; error: "invalid_username" | "not_found" | "cannot_revoke_owner" };

export async function revokePro(username: string): Promise<ProRevokeResult> {
  if (username === PRO_OWNER_USERNAME) {
    return { ok: false, error: "cannot_revoke_owner" };
  }
  const account = await db.account.findUnique({
    where: { username },
    select: { id: true },
  });
  if (!account) return { ok: false, error: "not_found" };
  await db.account.update({
    where: { username },
    data: { isPro: false, proGrantedBy: null, proGrantedAt: null },
  });
  return { ok: true, username };
}
