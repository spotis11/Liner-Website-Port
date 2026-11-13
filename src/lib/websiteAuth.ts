import crypto from "node:crypto";
import { db, ensureDbReady } from "@/lib/db";
import { isOwnerPro } from "@/lib/pro";

/**
 * Website-port accounts — OUR OWN login system, upstream-independent.
 *
 * WHY: upstream api.tryliner.fun sits behind a WAF that blocks datacenter
 * egress entirely (all /v1/* requests 403 from this host), so signing in was
 * impossible for anyone reaching the site from this server's network. These
 * accounts live in the website's own sqlite database (db/custom.db), which
 * survives republishes AND sandbox recycling — registered accounts and their
 * libraries are permanent.
 *
 * PASSWORDS: scrypt (node:crypto, N=16384) with a per-account 16-byte salt.
 * Format: scrypt$N$r$p$salt_hex$hash_hex. Verification is constant-time.
 *
 * TOKENS: 48 random bytes each, handed to the client as `at_…`/`rt_…`. The
 * database only stores sha256 hashes, so a db leak never leaks live sessions.
 * Access token lives 30 days (the client proactively refreshes 120 s before
 * expiry); the refresh token rotates on every use and lives 90 days.
 *
 * CLIENT CONTRACT: the response body mirrors the upstream AuthTokens shape
 * ({ accessToken, refreshToken, accessTokenExpiresAt, user }) so the SPA's
 * auth-session store keeps working untouched.
 */

export const ACCESS_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

// upstream PublicUser-compatible username slug
const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export class WebsiteAuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WebsiteAuthError";
  }
}

// ---- password hashing ------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password.normalize("NFKC"), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("hex"),
    hash.toString("hex"),
  ].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, n, r, p, saltHex, hashHex] = stored.split("$");
    if (scheme !== "scrypt") return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(
      password.normalize("NFKC"),
      Buffer.from(saltHex, "hex"),
      expected.length,
      { N: Number(n), r: Number(r), p: Number(p) },
    );
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ---- tokens ----------------------------------------------------------------

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function mintToken(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(48).toString("hex")}`;
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateRegistration(input: {
  email: string;
  password: string;
  username: string;
  displayName: string;
}): void {
  if (!EMAIL_RE.test(input.email.trim())) {
    throw new WebsiteAuthError(400, "INVALID_EMAIL", "Enter a valid email address.");
  }
  if (typeof input.password !== "string" || input.password.length < 8) {
    throw new WebsiteAuthError(
      400,
      "WEAK_PASSWORD",
      "Password must be at least 8 characters.",
    );
  }
  if (input.password.length > 200) {
    throw new WebsiteAuthError(400, "WEAK_PASSWORD", "Password is too long.");
  }
  const username = normalizeUsername(input.username ?? "");
  if (!USERNAME_RE.test(username)) {
    throw new WebsiteAuthError(
      400,
      "INVALID_USERNAME",
      "Username must be 3-24 lowercase letters, digits or underscores.",
    );
  }
  if (!input.displayName?.trim() || input.displayName.trim().length > 60) {
    throw new WebsiteAuthError(
      400,
      "INVALID_DISPLAY_NAME",
      "Display name must be 1-60 characters.",
    );
  }
}

/** Data-URL avatars up to this size stay inline in JSON payloads; anything
 *  larger (Liner Pro animated GIFs up to 30 MB) is rewritten to
 *  GET /api/avatar/[id] so /me, user finder and announcement payloads stay
 *  light and the browser caches the bytes instead. */
const AVATAR_INLINE_MAX_CHARS = 400_000;

export function toPublicUser(account: {
  id: string;
  email: string | null;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  isPublic: boolean;
  showActivity: boolean;
  showHistory: boolean;
  showLikedTracks: boolean;
  participateLeaderboards: boolean;
  passwordHash?: string | null;
  isGuest?: boolean | null;
  isPro?: boolean | null;
}) {
  return {
    id: account.id,
    email: account.email ?? undefined,
    username: account.username,
    displayName: account.displayName,
    avatarUrl:
      account.avatarUrl &&
      account.avatarUrl.startsWith("data:") &&
      account.avatarUrl.length > AVATAR_INLINE_MAX_CHARS
        ? `/api/avatar/${account.id}`
        : account.avatarUrl,
    bio: account.bio,
    isPublic: account.isPublic,
    showActivity: account.showActivity,
    showHistory: account.showHistory,
    showLikedTracks: account.showLikedTracks,
    participateLeaderboards: account.participateLeaderboards,
    // client hints only — never the hash itself. settings uses hasPassword
    // to show "add password" (Discord accounts) vs "change password".
    hasPassword: Boolean(account.passwordHash),
    isGuest: Boolean(account.isGuest),
    // Liner Pro — the owner is Pro forever regardless of the db flag.
    isPro: Boolean(account.isPro) || isOwnerPro(account.username),
  };
}

// ---- sessions ----------------------------------------------------------------

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
}

/** Mint both tokens and persist their hashes. */
export async function issueSession(
  accountId: string,
  userAgent: string | null,
): Promise<IssuedSession> {
  await ensureDbReady();
  const accessToken = mintToken("at");
  const refreshToken = mintToken("rt");
  await db.session.create({
    data: {
      accountId,
      tokenHash: sha256(accessToken),
      refreshHash: sha256(refreshToken),
      userAgent: userAgent?.slice(0, 300) ?? null,
      expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
    },
  });
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: new Date(
      Date.now() + ACCESS_TOKEN_TTL_MS,
    ).toISOString(),
  };
}

export interface VerifiedIdentity {
  accountId: string;
  username: string;
  sessionId: string;
}

/**
 * Verify a raw Bearer token against our own sessions. Cheap (single indexed
 * lookup), updates lastSeenAt best-effort.
 */
export async function verifyAccessToken(
  token: string | null | undefined,
): Promise<VerifiedIdentity | null> {
  if (!token || (!token.startsWith("at_") && !token.startsWith("rt_"))) {
    return null;
  }
  await ensureDbReady();
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    select: {
      id: true,
      accountId: true,
      expiresAt: true,
      account: { select: { username: true } },
    },
  });
  if (!session || session.expiresAt.getTime() <= Date.now()) return null;
  void db.session
    .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);
  return {
    accountId: session.accountId,
    username: session.account.username,
    sessionId: session.id,
  };
}

/**
 * Rotate a refresh token: the used token dies, a fresh pair is minted.
 * Reuse of a dead refresh token fails (the hash row is gone).
 */
export async function rotateSession(
  refreshToken: string,
): Promise<{ identity: VerifiedIdentity; session: IssuedSession } | null> {
  if (!refreshToken.startsWith("rt_")) return null;
  await ensureDbReady();
  const hash = sha256(refreshToken);
  const stale = await db.session.findUnique({
    where: { refreshHash: hash },
    select: { id: true, accountId: true, account: { select: { username: true } } },
  });
  if (!stale) return null;
  // Create the new Session row BEFORE deleting the old one. If issueSession
  // fails (DB hiccup, unique constraint), the old refresh token is still
  // valid — the client retries later instead of being force-logged-out.
  // (Previously delete-then-create: a failed issueSession left the client
  // holding a dead refresh token → forced logout on the next refresh.)
  const session = await issueSession(stale.accountId, null);
  await db.session.delete({ where: { id: stale.id } }).catch(() => undefined);
  return {
    identity: {
      accountId: stale.accountId,
      username: stale.account.username,
      sessionId: stale.id,
    },
    session,
  };
}

export async function destroySessionByRefreshToken(
  refreshToken: string | undefined,
): Promise<void> {
  if (!refreshToken) return;
  await ensureDbReady();
  await db.session
    .deleteMany({ where: { refreshHash: sha256(refreshToken) } })
    .catch(() => undefined);
}

// ---- accounts ----------------------------------------------------------------

async function assertAvailable(
  email: string,
  username: string,
): Promise<void> {
  const [emailRow, usernameRow] = await Promise.all([
    db.account.findUnique({
      where: { email },
      select: { id: true, username: true, isGuest: true, passwordHash: true },
    }),
    db.account.findUnique({
      where: { username },
      select: { id: true, username: true, isGuest: true, passwordHash: true },
    }),
  ]);
  if (emailRow) {
    if (!emailRow.isGuest && !emailRow.passwordHash) {
      // the email belongs to a Discord-linked (passwordless) account —
      // registering can never succeed, so tell the user the real way in
      throw new WebsiteAuthError(
        409,
        "DISCORD_ONLY",
        `An account with this email already exists (@${emailRow.username}) and was created with Discord — use 'Continue with Discord' to sign in.`,
      );
    }
    throw new WebsiteAuthError(
      409,
      "EMAIL_TAKEN",
      "This email is already registered — try logging in instead.",
    );
  }
  if (usernameRow) {
    if (!usernameRow.isGuest && !usernameRow.passwordHash) {
      throw new WebsiteAuthError(
        409,
        "DISCORD_ONLY",
        "That username belongs to an account that was created with Discord — pick a different username, or use 'Continue with Discord'.",
      );
    }
    throw new WebsiteAuthError(
      409,
      "USERNAME_TAKEN",
      "That username is already taken.",
    );
  }
}

/** Generate a collision-safe guest username (guest_ab12cd). */
async function nextGuestUsername(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = `guest_${crypto.randomBytes(3).toString("hex")}`;
    const taken = await db.account.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  return `guest_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Set or change the account's own password (Settings -> Account -> Security).
 * Discord-linked accounts can ADD a password — after that, email/username +
 * password login works for them too. Accounts that already have a password
 * must confirm the current one. Guests cannot (they have no email).
 */
export async function setAccountPassword(input: {
  accountId: string;
  currentPassword?: string;
  password: string;
}): Promise<void> {
  await ensureDbReady();
  if (
    typeof input.password !== "string" ||
    input.password.length < 8 ||
    input.password.length > 200
  ) {
    throw new WebsiteAuthError(
      400,
      "WEAK_PASSWORD",
      "Password must be at least 8 characters.",
    );
  }
  const account = await db.account.findUnique({
    where: { id: input.accountId },
  });
  if (!account || account.isGuest) {
    throw new WebsiteAuthError(
      403,
      "GUEST_ACCOUNT",
      "Guest accounts cannot set a password.",
    );
  }
  if (account.passwordHash) {
    if (
      !input.currentPassword ||
      !verifyPassword(input.currentPassword, account.passwordHash)
    ) {
      throw new WebsiteAuthError(
        403,
        "WRONG_PASSWORD",
        "Current password is incorrect.",
      );
    }
  }
  await db.account.update({
    where: { id: input.accountId },
    data: { passwordHash: hashPassword(input.password) },
  });
}

export async function createAccount(input: {
  email: string;
  password: string;
  username: string;
  displayName: string;
  userAgent: string | null;
}) {
  await ensureDbReady();
  const email = input.email.trim().toLowerCase();
  const username = normalizeUsername(input.username);
  validateRegistration({ ...input, email, username });
  await assertAvailable(email, username);
  const account = await db.account.create({
    data: {
      email,
      username,
      displayName: input.displayName.trim(),
      passwordHash: hashPassword(input.password),
    },
  });
  const session = await issueSession(account.id, input.userAgent);
  return { account, session };
}

export async function authenticate(
  emailOrUsername: string,
  password: string,
  userAgent: string | null,
) {
  await ensureDbReady();
  const identifier = emailOrUsername.trim().toLowerCase();
  if (!identifier || !password) {
    throw new WebsiteAuthError(
      400,
      "MISSING_CREDENTIALS",
      "Enter your email and password.",
    );
  }
  const account = await db.account.findFirst({
    where: {
      OR: [{ email: identifier }, { username: identifier }],
    },
  });
  // scrypt verification runs even for a missing account so response timing
  // does not reveal whether the identifier exists
  const hash =
    account?.passwordHash ??
    "scrypt$16384$8$1$00$00".padEnd(80, "0");
  const ok = verifyPassword(password, hash);
  if (account && !account.isGuest && !account.passwordHash) {
    // the account exists but has no password of its own (created via Discord
    // OAuth) — password login can never succeed for it, so point the user to
    // the Discord button instead of a misleading "wrong password"
    throw new WebsiteAuthError(
      401,
      "DISCORD_ONLY",
      "This account was created with Discord. Use 'Continue with Discord' to sign in.",
    );
  }
  if (!account || !ok || account.isGuest) {
    throw new WebsiteAuthError(
      401,
      "INVALID_CREDENTIALS",
      "Wrong email or password.",
    );
  }
  const session = await issueSession(account.id, userAgent);
  return { account, session };
}

export async function createGuestAccount(
  userAgent: string | null,
): Promise<{
  account: {
    id: string;
    username: string;
    displayName: string;
  };
  session: IssuedSession;
}> {
  await ensureDbReady();
  const username = await nextGuestUsername();
  const short = username.split("_")[1] ?? "";
  const account = await db.account.create({
    data: {
      username,
      displayName: `Guest ${short.toUpperCase()}`,
      isGuest: true,
    },
  });
  const session = await issueSession(account.id, userAgent);
  return {
    account: {
      id: account.id,
      username: account.username,
      displayName: account.displayName,
    },
    session,
  };
}

// ---- discord oauth accounts -------------------------------------------------

export interface DiscordLoginProfile {
  id: string;
  username: string;
  globalName: string | null;
  email: string | null;
  avatarUrl: string;
}

/**
 * Collision-safe username from a Discord handle: same charset as our own
 * USERNAME_RE (3-24 lowercase a-z0-9_), falls back to dc_<id-suffix> when the
 * handle is too short, and gets a random suffix when it is already taken.
 */
async function nextDiscordUsername(raw: string, discordId: string): Promise<string> {
  const base =
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 24) || `dc_${discordId.slice(-6).toLowerCase()}`;
  const seed = base.length >= 3 ? base : `dc_${discordId.slice(-6).toLowerCase()}`;
  const direct = await db.account.findUnique({
    where: { username: seed },
    select: { id: true },
  });
  if (!direct) return seed;
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = `${seed.slice(0, 19)}_${crypto.randomBytes(2).toString("hex")}`;
    const taken = await db.account.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  return `dc_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Sign in (or auto-create / auto-link) a website account from a Discord
 * profile. Resolution order:
 *  1. discordId already linked → sign in (refresh the Discord avatar if the
 *     stored one is unset or was Discord-hosted, never clobbering a custom one)
 *  2. same verified email as an existing account → link that account
 *  3. otherwise create a new account (no password — Discord is the credential)
 */
export async function loginWithDiscord(
  profile: DiscordLoginProfile,
  userAgent: string | null,
) {
  await ensureDbReady();
  let account = await db.account.findUnique({
    where: { discordId: profile.id },
  });

  if (!account && profile.email) {
    const byEmail = await db.account.findUnique({
      where: { email: profile.email.trim().toLowerCase() },
    });
    if (byEmail) {
      account = await db.account.update({
        where: { id: byEmail.id },
        data: { discordId: profile.id },
      });
    }
  }

  if (!account) {
    const username = await nextDiscordUsername(profile.username, profile.id);
    account = await db.account.create({
      data: {
        username,
        displayName: (profile.globalName || profile.username)
          .trim()
          .slice(0, 60) || username,
        email: profile.email?.trim().toLowerCase() ?? null,
        discordId: profile.id,
        avatarUrl: profile.avatarUrl,
      },
    });
  } else {
    const isDiscordAvatar = account.avatarUrl?.includes("cdn.discordapp.com");
    if (profile.avatarUrl && (isDiscordAvatar || !account.avatarUrl)) {
      account = await db.account.update({
        where: { id: account.id },
        data: { avatarUrl: profile.avatarUrl },
      });
    }
  }

  const session = await issueSession(account.id, userAgent);
  return { account, session };
}

/** Map a bare {id, username, displayName} guest into a full PublicUser. */
export function guestPublicUser(account: {
  id: string;
  username: string;
  displayName: string;
}) {
  return toPublicUser({
    id: account.id,
    email: null,
    username: account.username,
    displayName: account.displayName,
    avatarUrl: null,
    bio: null,
    isPublic: false,
    showActivity: false,
    showHistory: false,
    showLikedTracks: false,
    participateLeaderboards: false,
  });
}
