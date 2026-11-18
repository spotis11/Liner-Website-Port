import { create } from "zustand";
import type { BanCheckResult, BanInfo, BanType } from "../lib/moderationApi";

/**
 * Website-port ban gate state. When `ban` is non-null the BanGate renders
 * the full-screen banned overlay over the entire app (login included) and
 * the signed-in session has already been dropped.
 *
 * The active ban is mirrored into localStorage so the wall SURVIVES page
 * reloads (normal and hard): a browser that has been shown a ban keeps
 * seeing it on boot, before and even without any network probe. Only the
 * website backend can release it (ban lifted / expired — expired records
 * self-heal here too, matching the server-side auto-prune).
 */
export type BanState = {
  ban: BanInfo | null;
  setBan: (ban: BanInfo) => void;
  clearBan: () => void;
};

const STORAGE_KEY = "liner_web_ban_v1";

function isBanType(value: unknown): value is BanType {
  return value === "normal" || value === "ip";
}

/** Read the persisted wall back, ignoring corrupt records and expired bans. */
export function readPersistedBan(storage: Storage | null): BanInfo | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BanInfo> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.username !== "string" || parsed.username.length === 0) return null;
    if (!isBanType(parsed.type)) return null;
    if (typeof parsed.createdAt !== "string") return null;
    if (parsed.expiresAt !== null && typeof parsed.expiresAt !== "string") return null;
    const expiresAt = parsed.expiresAt ?? null;
    // Expired bans self-heal exactly like the server's auto-prune: the
    // visitor is free again, no probe needed.
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      storage.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      username: parsed.username,
      type: parsed.type,
      reason: typeof parsed.reason === "string" ? parsed.reason : null,
      createdAt: parsed.createdAt,
      expiresAt,
      avatarUrl: typeof parsed.avatarUrl === "string" && parsed.avatarUrl ? parsed.avatarUrl : null,
    };
  } catch {
    return null;
  }
}

function writePersistedBan(storage: Storage | null, ban: BanInfo | null): void {
  if (!storage) return;
  try {
    if (!ban) {
      storage.removeItem(STORAGE_KEY);
      return;
    }
    const record = {
      username: ban.username,
      type: ban.type,
      reason: ban.reason,
      createdAt: ban.createdAt,
      expiresAt: ban.expiresAt,
      avatarUrl: ban.avatarUrl ?? null,
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // private mode / quota errors must never break the gate
  }
}

export function createBanStore(storage: Storage | null = typeof window === "undefined" ? null : window.localStorage) {
  return create<BanState>((set) => ({
    // Synchronous hydration: the wall is up on the very first paint, before
    // any probe or session restore has a chance to flash the app.
    ban: readPersistedBan(storage),
    setBan: (ban) => {
      writePersistedBan(storage, ban);
      set({ ban });
    },
    clearBan: () => {
      writePersistedBan(storage, null);
      set({ ban: null });
    },
  }));
}

export const useBanStore = createBanStore();

/**
 * What the BanGate does with a check-probe answer. Kept pure for tests:
 *  - "wall"    → the server confirms a ban (raise/refresh the wall);
 *  - "release" → the server authoritatively answered "not banned" for this
 *                visitor (fresh token, remembered username or IP) — drop the
 *                wall if one is up;
 *  probe TRANSPORT failures never reach this function — the gate simply does
 *  nothing then, so an already-raised wall stays up (fail-closed for
 *  known-banned browsers) while unknown visitors stay fail-open.
 */
export type BanGateDecision =
  | { action: "wall"; ban: BanInfo }
  | { action: "release" };

export function toBanInfo(
  result: BanCheckResult,
  fallbackUsername: string | null,
  avatarUrl: string | null | undefined,
): BanInfo {
  return {
    username: result.username ?? fallbackUsername ?? "",
    type: result.type === "ip" ? ("ip" as const) : ("normal" as const),
    reason: result.reason ?? null,
    createdAt: new Date().toISOString(),
    expiresAt: result.expiresAt ?? null,
    avatarUrl: avatarUrl ?? null,
  };
}

export function decideBanGateAction(
  result: BanCheckResult,
  fallbackUsername: string | null,
  avatarUrl?: string | null | undefined,
): BanGateDecision {
  if (result.banned) {
    return { action: "wall", ban: toBanInfo(result, fallbackUsername, avatarUrl) };
  }
  return { action: "release" };
}
