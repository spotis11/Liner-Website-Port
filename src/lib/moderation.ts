import { db, ensureDbReady, refreshBansMirror } from "@/lib/db";
import {
  ANNOUNCEMENT_ADMIN_USERNAME,
  fetchLinerMeVerified,
  verifyAnnouncementAdmin,
} from "@/lib/announcements";

/**
 * Website-port moderation (ban) system.
 *
 * The site owner (Liner username jayzeyluna) can ban accounts from THIS
 * website only — the upstream Liner API is untouched, the desktop app knows
 * nothing about it. Two ban types:
 *
 *  - "normal": blocks the account from signing in / staying signed in on the
 *    website (the login flow and every client's periodic ban check refuse it).
 *  - "ip": everything a normal ban does, plus the account's known network
 *    addresses are frozen site-wide — any visitor from those addresses
 *    (whatever account they try) is blocked too.
 *
 * Duration is hours-based or forever (expiresAt === null). Bans can always
 * be lifted again by typing the account's Liner username.
 */

export const MODERATION_ADMIN_USERNAME = ANNOUNCEMENT_ADMIN_USERNAME;

export const BAN_TYPES = ["normal", "ip"] as const;
export type BanType = (typeof BAN_TYPES)[number];

/** Liner username rules (matches the upstream registration validator). */
const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

/** Sanity cap for hour-based bans (10 years). */
export const BAN_MAX_HOURS = 87_600;

/** Longest reason string we store. */
export const BAN_REASON_MAX = 300;

export interface BanDTO {
  username: string;
  type: BanType;
  reason: string | null;
  /** ISO timestamp of the ban creation moment. */
  createdAt: string;
  /** ISO timestamp when the ban lifts, or null for forever. */
  expiresAt: string | null;
  createdBy: string;
  /** Network addresses frozen by this ban (ip-type bans only). */
  bannedIps: string[];
}

export interface BanCheckResult {
  banned: boolean;
  username: string | null;
  type: BanType | null;
  reason: string | null;
  expiresAt: string | null;
}

export function normalizeUsername(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const username = input.trim().toLowerCase();
  return USERNAME_RE.test(username) ? username : null;
}

/**
 * Best-effort client address extraction behind the gateway. Returns
 * "unknown" when nothing trustworthy is present; every db touch with an
 * unknown address is skipped.
 */
export function clientIpFromHeader(xff: string | null, realIp: string | null): string {
  const candidates: string[] = [];
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) candidates.push(first);
  }
  if (realIp) candidates.push(realIp.trim());
  for (const candidate of candidates) {
    let ip = candidate.toLowerCase();
    // strip zone index (fe80::1%eth0) and IPv4-mapped IPv6 prefix
    const percent = ip.indexOf("%");
    if (percent > 0) ip = ip.slice(0, percent);
    const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) ip = mapped[1];
    const looksValid = /^(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]{3,45})$/.test(ip);
    if (looksValid) return ip.slice(0, 64);
  }
  return "unknown";
}

export type AdminVerification = ReturnType<typeof verifyAnnouncementAdmin>;

/**
 * Verify a Liner access token and make sure it belongs to the site owner.
 * Thin alias over the announcement admin check — same account, same gate.
 */
export function verifyModerationAdmin(accessToken: string): AdminVerification {
  return verifyAnnouncementAdmin(accessToken);
}

/**
 * Verify an arbitrary Liner access token and return its account username
 * (lowercase), or null when the token is dead or upstream is unreachable.
 * Used by the public check probe to only record IP sightings for genuinely
 * signed-in accounts (prevents third parties from poisoning the ip map).
 * Browser-like headers + one retry — same hardening as the admin gate.
 */
export async function verifyLinerToken(
  accessToken: string,
): Promise<string | null> {
  const full = await verifyLinerTokenFull(accessToken);
  return full?.username ?? null;
}

export interface LinerIdentity {
  username: string;
  me: Record<string, unknown>;
}

/**
 * Same verification as verifyLinerToken, but keeps the full upstream /v1/me
 * payload so the website can cache what an account volunteers about itself
 * (email, display name, avatar, account creation date) for the site owner's
 * User Finder. Returns null for dead tokens / unreachable upstream.
 */
export async function verifyLinerTokenFull(
  accessToken: string,
): Promise<LinerIdentity | null> {
  try {
    const probe = await fetchLinerMeVerified(accessToken, 6_000);
    if (probe.status !== "ok") return null;
    const me = probe.me as Record<string, unknown>;
    const username =
      typeof me?.username === "string" ? me.username.trim().toLowerCase() : "";
    return USERNAME_RE.test(username) ? { username, me } : null;
  } catch {
    return null;
  }
}

/**
 * Persist what a verified account's own session proves about it (User Finder
 * cache). Only called with a token-verified identity — unverified claims are
 * never stored. Best effort: any failure must not break the ban probe.
 */
export async function recordUserSeen(
  identity: LinerIdentity,
): Promise<void> {
  try {
    const me = identity.me ?? {};
    const str = (value: unknown): string | null =>
      typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null;
    // avatars arrive as full data:image/...;base64 URIs — tens of KB long.
    // Capping them at 300 chars (like every other field) truncates the
    // payload into an unrenderable string = "no profile picture".
    const avatar = (value: unknown): string | null =>
      typeof value === "string" && value.trim()
        ? value.trim().slice(0, 400_000)
        : null;
    const date = (value: unknown): Date | null => {
      if (typeof value === "string") {
        const parsed = new Date(value);
        return Number.isFinite(parsed.getTime()) ? parsed : null;
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        // epoch seconds vs milliseconds — 10^12 is "Sep 2001 in ms"
        const ms = value < 1e12 ? value * 1000 : value;
        const parsed = new Date(ms);
        return Number.isFinite(parsed.getTime()) ? parsed : null;
      }
      return null;
    };
    const data = {
      username: identity.username,
      email: str(me.email),
      userId: str(me.id),
      displayName: str(me.displayName),
      avatarUrl: avatar(me.avatarUrl),
      bio: str(me.bio),
      accountCreatedAt:
        date(me.createdAt) ?? date(me.created_at) ?? date(me.createdAtIso),
      // diagnostics copy with the (huge) avatar data-uri masked out so the
      // remaining keys stay readable within the budget
      raw: (() => {
        try {
          const clone: Record<string, unknown> = { ...me };
          if (typeof clone.avatarUrl === "string" && clone.avatarUrl.length > 64) {
            clone.avatarUrl = `[data-uri ${clone.avatarUrl.length} chars]`;
          }
          return JSON.stringify(clone).slice(0, 8000);
        } catch {
          return null;
        }
      })(),
    };
    await db.userSeen.upsert({
      where: { username: data.username },
      // lastSeenAt always moves; profile fields only fill in (never blank out)
      create: data,
      update: {
        email: data.email ?? undefined,
        userId: data.userId ?? undefined,
        displayName: data.displayName ?? undefined,
        avatarUrl: data.avatarUrl ?? undefined,
        bio: data.bio ?? undefined,
        accountCreatedAt: data.accountCreatedAt ?? undefined,
        raw: data.raw ?? undefined,
      },
    });
  } catch (err) {
    console.warn("[moderation] user-seen cache failed:", err);
  }
}

function isBanRow(row: { type: string; expiresAt: Date | null }): boolean {
  if (!BAN_TYPES.includes(row.type as BanType)) return false;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return false;
  return true;
}

/** Housekeeping: drop expired bans and the IP freezes that belonged to them. */
export async function pruneExpiredBans(): Promise<void> {
  try {
    const expired = await db.ban.findMany({
      where: { expiresAt: { not: null, lte: new Date() } },
      select: { username: true },
    });
    if (expired.length > 0) {
      const usernames = expired.map((row) => row.username);
      await db.ban.deleteMany({ where: { username: { in: usernames } } });
      await db.banIp.deleteMany({ where: { username: { in: usernames } } });
    }
  } catch {
    // housekeeping must never break a check
  }
}

/** Record (best effort) which network address an account was last seen from. */
export async function recordIpSeen(ip: string, username: string): Promise<void> {
  if (ip === "unknown") return;
  try {
    await db.ipSeen.upsert({
      where: { ip },
      create: { ip, username },
      update: { username },
    });
  } catch {
    // mapping is best effort
  }
}

function serializeBan(
  row: {
    username: string;
    type: string;
    reason: string | null;
    createdAt: Date;
    expiresAt: Date | null;
    createdBy: string;
  },
  bannedIps: string[],
): BanDTO {
  return {
    username: row.username,
    type: row.type as BanType,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdBy: row.createdBy,
    bannedIps,
  };
}

/** All active bans, newest first, with their frozen IP lists. */
export async function listBans(): Promise<BanDTO[]> {
  // Self-heals a fresh/wiped database (and restores the bans mirror) first.
  await ensureDbReady();
  await pruneExpiredBans();
  const rows = await db.ban.findMany({ orderBy: { createdAt: "desc" } });
  if (rows.length === 0) return [];
  const frozen = await db.banIp.findMany();
  const byUsername = new Map<string, string[]>();
  for (const row of frozen) {
    const list = byUsername.get(row.username) ?? [];
    list.push(row.ip);
    byUsername.set(row.username, list);
  }
  return rows
    .filter((row) => isBanRow(row))
    .map((row) => serializeBan(row, (byUsername.get(row.username) ?? []).sort()));
}

export type AddBanResult =
  | { ok: true; ban: BanDTO }
  | { ok: false; error: "invalid_username" | "invalid_type" | "invalid_duration" | "cannot_ban_admin" };

/**
 * Create (or replace) the ban for one account. An "ip" ban freezes every
 * network address the account has been seen from so far.
 */
export async function addBan(input: {
  username: string;
  type: BanType;
  durationHours: number | null;
  reason: string | null;
  createdBy: string;
}): Promise<AddBanResult> {
  const username = normalizeUsername(input.username);
  if (!username) return { ok: false, error: "invalid_username" };
  if (username === MODERATION_ADMIN_USERNAME) {
    return { ok: false, error: "cannot_ban_admin" };
  }
  const { type, durationHours, reason, createdBy } = input;
  if (!BAN_TYPES.includes(type)) return { ok: false, error: "invalid_type" };
  if (
    durationHours !== null &&
    (!Number.isFinite(durationHours) ||
      durationHours <= 0 ||
      durationHours > BAN_MAX_HOURS)
  ) {
    return { ok: false, error: "invalid_duration" };
  }

  const expiresAt =
    durationHours === null ? null : new Date(Date.now() + durationHours * 3_600_000);

  // Self-heals a fresh/wiped database (and restores the bans mirror) first.
  await ensureDbReady();

  await db.$transaction([
    db.ban.deleteMany({ where: { username } }),
    db.ban.create({
      data: {
        username,
        type,
        reason: reason?.trim() ? reason.trim().slice(0, BAN_REASON_MAX) : null,
        createdBy,
        expiresAt,
      },
    }),
  ]);

  let frozenIps: string[] = [];
  if (type === "ip") {
    const seen = await db.ipSeen.findMany({
      where: { username },
      select: { ip: true },
    });
    if (seen.length > 0) {
      await db.banIp.createMany({
        data: seen.map((row) => ({ ip: row.ip, username })),
        skipDuplicates: true,
      });
    }
    frozenIps = seen.map((row) => row.ip).sort();
  }

  const row = await db.ban.findUnique({ where: { username } });
  if (!row) throw new Error("ban vanished after create");
  // Keep the on-disk mirror in sync so a lost/reset db file can never erase
  // the owner's ban list (fire-and-forget — never fail the mutation).
  void refreshBansMirror().catch(() => {});
  return { ok: true, ban: serializeBan(row, frozenIps) };
}

export type RemoveBanResult =
  | { ok: true; removed: true; removedIps: number }
  | { ok: false; error: "invalid_username" | "not_banned" };

/** Lift a ban by Liner username (also un-freezes the IPs it had frozen). */
export async function removeBan(username: string): Promise<RemoveBanResult> {
  const normalized = normalizeUsername(username);
  if (!normalized) return { ok: false, error: "invalid_username" };
  await ensureDbReady();
  const existing = await db.ban.findUnique({ where: { username: normalized } });
  if (!existing) return { ok: false, error: "not_banned" };
  const removed = await db.$transaction([
    db.ban.delete({ where: { username: normalized } }),
    db.banIp.deleteMany({ where: { username: normalized } }),
  ]);
  void refreshBansMirror().catch(() => {});
  return { ok: true, removed: true, removedIps: removed[1].count };
}

/**
 * Evaluate one visitor: is this account (or this network address) banned on
 * the website? Fails open — any internal error reports "not banned" so a db
 * hiccup can never lock everyone out.
 *
 * For visitors signed in as an ip-banned account, the address they are
 * arriving from is additionally frozen site-wide (rotation-proofing).
 */
export async function evaluateBan(input: {
  username?: string | null;
  ip?: string | null;
}): Promise<BanCheckResult> {
  const notBanned: BanCheckResult = {
    banned: false,
    username: null,
    type: null,
    reason: null,
    expiresAt: null,
  };
  try {
    await ensureDbReady();
    await pruneExpiredBans();

    const username = normalizeUsername(input.username ?? undefined);
    const ip = typeof input.ip === "string" ? input.ip : "unknown";

    // The site owner can never be walled — not by their own account (they
    // cannot be banned) and not by a frozen network address. Without this,
    // testing an "ip" ban on an alt account from the owner's own network
    // would freeze the owner's address and lock THEM out of the website.
    if (username === MODERATION_ADMIN_USERNAME) {
      return notBanned;
    }

    if (username) {
      const ownBan = await db.ban.findUnique({ where: { username } });
      if (ownBan && isBanRow(ownBan)) {
        // ip-banned accounts get every fresh address frozen automatically
        if (ownBan.type === "ip" && ip !== "unknown") {
          await db.banIp.upsert({
            where: { ip },
            create: { ip, username },
            update: { username },
          });
        }
        return {
          banned: true,
          username,
          type: ownBan.type as BanType,
          reason: ownBan.reason,
          expiresAt: ownBan.expiresAt ? ownBan.expiresAt.toISOString() : null,
        };
      }
    }

    if (ip !== "unknown") {
      const frozen = await db.banIp.findUnique({ where: { ip } });
      if (frozen) {
        const ownerBan = await db.ban.findUnique({ where: { username: frozen.username } });
        if (ownerBan && isBanRow(ownerBan)) {
          return {
            banned: true,
            username: frozen.username,
            type: "ip",
            reason: ownerBan.reason,
            expiresAt: ownerBan.expiresAt ? ownerBan.expiresAt.toISOString() : null,
          };
        }
        // stale freeze (owning ban is gone) — self-heal
        await db.banIp.deleteMany({ where: { username: frozen.username } });
      }
    }

    return notBanned;
  } catch {
    return notBanned;
  }
}
