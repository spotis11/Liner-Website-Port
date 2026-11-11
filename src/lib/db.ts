import { PrismaClient } from '@prisma/client'
import { mkdirSync } from 'fs'
import { dirname, resolve } from 'path'

/**
 * Resilient Prisma client for the website port.
 *
 * Why this file is defensive: the moderation (bans), announcements and
 * admin-gate features store their state in this SQLite database. The env
 * file that used to define DATABASE_URL is git-ignored, so a fresh clone /
 * platform republish used to boot with NO database URL at all — every query
 * then failed and moderation silently failed open ("the bans are gone").
 *
 * Three layers of self-healing live here:
 *  1. A hard-coded fallback URL when DATABASE_URL is missing or empty.
 *  2. `ensureDbReady()` — idempotent CREATE TABLE IF NOT EXISTS DDL for every
 *     model, so a fresh or wiped database file provisions itself on boot.
 *  3. A JSON mirror of the bans (written on every ban mutation, restored
 *     automatically when the Ban table is found empty) so a lost or reset
 *     database file cannot erase the site owner's ban list.
 */

const FALLBACK_DATABASE_URL = 'file:/home/z/my-project/db/custom.db'

const rawUrl = process.env.DATABASE_URL?.trim()
const databaseUrl = rawUrl ? rawUrl : FALLBACK_DATABASE_URL

/** Absolute filesystem path for file: URLs (null for other providers). */
function sqlitePathFromUrl(url: string): string | null {
  if (!url.startsWith('file:')) return null
  const withoutQuery = url.slice('file:'.length).split('?')[0] ?? ''
  if (!withoutQuery) return null
  return resolve(withoutQuery)
}

const sqliteFilePath = sqlitePathFromUrl(databaseUrl)
if (sqliteFilePath) {
  try {
    mkdirSync(dirname(sqliteFilePath), { recursive: true })
  } catch {
    // the directory normally exists; Prisma will surface a real error if not
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
    datasourceUrl: databaseUrl,
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// --- Schema self-healing ----------------------------------------------------
// Mirrors prisma/schema.prisma 1:1. `prisma db push` remains the source of
// truth; these statements only provision a missing database so a fresh
// environment works instead of failing every query.

const SCHEMA_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "Playlist" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "PlaylistTrack" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "playlistId" TEXT NOT NULL,
  "trackId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'audius',
  "title" TEXT NOT NULL,
  "artist" TEXT NOT NULL,
  "artistId" TEXT,
  "artwork" TEXT,
  "duration" INTEGER NOT NULL DEFAULT 0,
  "position" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlaylistTrack_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`,
  `CREATE INDEX IF NOT EXISTS "PlaylistTrack_playlistId_idx" ON "PlaylistTrack"("playlistId")`,
  `CREATE TABLE IF NOT EXISTS "LikedTrack" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "trackId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'audius',
  "title" TEXT NOT NULL,
  "artist" TEXT NOT NULL,
  "artistId" TEXT,
  "artwork" TEXT,
  "duration" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "LikedTrack_trackId_key" ON "LikedTrack"("trackId")`,
  `CREATE TABLE IF NOT EXISTS "PlayHistory" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "trackId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'audius',
  "title" TEXT NOT NULL,
  "artist" TEXT NOT NULL,
  "artistId" TEXT,
  "artwork" TEXT,
  "duration" INTEGER NOT NULL DEFAULT 0,
  "playedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE INDEX IF NOT EXISTS "PlayHistory_playedAt_idx" ON "PlayHistory"("playedAt")`,
  `CREATE TABLE IF NOT EXISTS "Announcement" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "message" TEXT NOT NULL,
  "senderUsername" TEXT NOT NULL,
  "senderName" TEXT NOT NULL,
  "senderAvatarUrl" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "showAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE INDEX IF NOT EXISTS "Announcement_showAt_idx" ON "Announcement"("showAt")`,
  `CREATE INDEX IF NOT EXISTS "Announcement_createdAt_idx" ON "Announcement"("createdAt")`,
  `CREATE TABLE IF NOT EXISTS "Ban" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "username" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'normal',
  "reason" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Ban_username_key" ON "Ban"("username")`,
  `CREATE INDEX IF NOT EXISTS "Ban_expiresAt_idx" ON "Ban"("expiresAt")`,
  `CREATE TABLE IF NOT EXISTS "IpSeen" (
  "ip" TEXT NOT NULL PRIMARY KEY,
  "username" TEXT NOT NULL,
  "updatedAt" DATETIME NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS "IpSeen_username_idx" ON "IpSeen"("username")`,
  `CREATE TABLE IF NOT EXISTS "BanIp" (
  "ip" TEXT NOT NULL PRIMARY KEY,
  "username" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE INDEX IF NOT EXISTS "BanIp_username_idx" ON "BanIp"("username")`,
  `CREATE TABLE IF NOT EXISTS "SystemKey" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "value" TEXT NOT NULL,
  "updatedAt" DATETIME NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "UserSeen" (
  "username" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT,
  "userId" TEXT,
  "displayName" TEXT,
  "avatarUrl" TEXT,
  "bio" TEXT,
  "accountCreatedAt" DATETIME,
  "raw" TEXT,
  "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" DATETIME NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS "UserSeen_lastSeenAt_idx" ON "UserSeen"("lastSeenAt")`,
  `CREATE TABLE IF NOT EXISTS "EmailLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "type" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "refKey" TEXT NOT NULL,
  "provider" TEXT,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "EmailLog_type_refKey_key" ON "EmailLog"("type", "refKey")`,
  `CREATE INDEX IF NOT EXISTS "EmailLog_createdAt_idx" ON "EmailLog"("createdAt")`,
  // --- website-port accounts (our own auth, upstream-independent) ---
  `CREATE TABLE IF NOT EXISTS "Account" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT,
  "username" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "passwordHash" TEXT,
  "discordId" TEXT,
  "avatarUrl" TEXT,
  "bio" TEXT,
  "isGuest" BOOLEAN NOT NULL DEFAULT false,
  "isPublic" BOOLEAN NOT NULL DEFAULT true,
  "showActivity" BOOLEAN NOT NULL DEFAULT true,
  "showHistory" BOOLEAN NOT NULL DEFAULT true,
  "showLikedTracks" BOOLEAN NOT NULL DEFAULT true,
  "participateLeaderboards" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Account_email_key" ON "Account"("email")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Account_username_key" ON "Account"("username")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Account_discordId_key" ON "Account"("discordId")`,
  `CREATE INDEX IF NOT EXISTS "Account_createdAt_idx" ON "Account"("createdAt")`,
  `CREATE TABLE IF NOT EXISTS "Session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "refreshHash" TEXT NOT NULL,
  "userAgent" TEXT,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" DATETIME NOT NULL
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Session_tokenHash_key" ON "Session"("tokenHash")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Session_refreshHash_key" ON "Session"("refreshHash")`,
  `CREATE INDEX IF NOT EXISTS "Session_accountId_idx" ON "Session"("accountId")`,
  `CREATE INDEX IF NOT EXISTS "Session_expiresAt_idx" ON "Session"("expiresAt")`,
  `CREATE TABLE IF NOT EXISTS "AccountTrack" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "trackId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'youtube',
  "title" TEXT NOT NULL,
  "artist" TEXT NOT NULL,
  "artistId" TEXT,
  "artwork" TEXT,
  "durationMs" INTEGER NOT NULL DEFAULT 0,
  "snapshot" TEXT,
  "likedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AccountTrack_accountId_trackId_key" ON "AccountTrack"("accountId", "trackId")`,
  `CREATE INDEX IF NOT EXISTS "AccountTrack_accountId_likedAt_idx" ON "AccountTrack"("accountId", "likedAt")`,
  `CREATE TABLE IF NOT EXISTS "AccountPlaylist" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "isPublic" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS "AccountPlaylist_accountId_updatedAt_idx" ON "AccountPlaylist"("accountId", "updatedAt")`,
  `CREATE TABLE IF NOT EXISTS "AccountPlaylistItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "playlistId" TEXT NOT NULL,
  "trackId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'youtube',
  "title" TEXT NOT NULL,
  "artist" TEXT NOT NULL,
  "artistId" TEXT,
  "artwork" TEXT,
  "durationMs" INTEGER NOT NULL DEFAULT 0,
  "snapshot" TEXT,
  "position" INTEGER NOT NULL,
  "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AccountPlaylistItem_playlistId_trackId_key" ON "AccountPlaylistItem"("playlistId", "trackId")`,
  `CREATE INDEX IF NOT EXISTS "AccountPlaylistItem_playlistId_position_idx" ON "AccountPlaylistItem"("playlistId", "position")`,
]

// Column additions for pre-existing tables: SQLite has no ADD COLUMN IF NOT
// EXISTS, so each migration checks pragma table_info first (boot-time, cheap).
async function migrateColumns(): Promise<void> {
  const needed = [
    { table: 'PlayHistory', column: 'username', ddl: 'ALTER TABLE "PlayHistory" ADD COLUMN "username" TEXT' },
    { table: 'Account', column: 'discordId', ddl: 'ALTER TABLE "Account" ADD COLUMN "discordId" TEXT' },
  ] as const
  for (const { table, column, ddl } of needed) {
    try {
      const rows = await db.$queryRawUnsafe<{ name: string }[]>(
        `PRAGMA table_info("${table}")`,
      )
      if (Array.isArray(rows) && !rows.some((row) => row.name === column)) {
        await db.$executeRawUnsafe(ddl)
        if (table === 'Account' && column === 'discordId') {
          // fresh column → every value is NULL → the unique index always builds
          try {
            await db.$executeRawUnsafe(
              `CREATE UNIQUE INDEX IF NOT EXISTS "Account_discordId_key" ON "Account"("discordId")`,
            )
          } catch {
            // index is an optimization only
          }
        }
        try {
          await db.$executeRawUnsafe(
            `CREATE INDEX IF NOT EXISTS "PlayHistory_username_idx" ON "PlayHistory"("username")`,
          )
        } catch {
          // index is an optimization only
        }
      }
    } catch (err) {
      console.warn(`[db] column migration ${table}.${column} failed:`, err)
    }
  }
}

// --- Bans mirror ------------------------------------------------------------

interface MirrorBan {
  username: string
  type: string
  reason: string | null
  createdBy: string
  createdAt: string
  expiresAt: string | null
}

interface MirrorBanIp {
  ip: string
  username: string
}

interface BansMirror {
  savedAt: string
  bans: MirrorBan[]
  banIps: MirrorBanIp[]
}

/** <db file dir>/bans-mirror.json — survives anything that hits only the db. */
function bansMirrorPath(): string | null {
  if (!sqliteFilePath) return null
  return resolve(dirname(sqliteFilePath), 'bans-mirror.json')
}

async function writeJsonAtomic(target: string, data: unknown): Promise<void> {
  const { writeFileSync, renameSync } = await import('fs')
  const tmp = `${target}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, target)
}

/**
 * Snapshot the current ban rows + frozen IPs into the mirror file. Called by
 * the moderation lib after every successful ban mutation. Best-effort: a
 * mirror failure must never fail the mutation itself.
 */
export async function refreshBansMirror(): Promise<void> {
  const target = bansMirrorPath()
  if (!target) return
  const bans = await db.ban.findMany({
    select: {
      username: true,
      type: true,
      reason: true,
      createdBy: true,
      createdAt: true,
      expiresAt: true,
    },
  })
  const banIps = await db.banIp.findMany({
    select: { ip: true, username: true },
  })
  const mirror: BansMirror = {
    savedAt: new Date().toISOString(),
    bans: bans.map((row) => ({
      username: row.username,
      type: row.type,
      reason: row.reason,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    })),
    banIps: banIps.map((row) => ({ ip: row.ip, username: row.username })),
  }
  await writeJsonAtomic(target, mirror)
}

function parseMirror(raw: string): BansMirror | null {
  try {
    const parsed = JSON.parse(raw) as Partial<BansMirror> | null
    if (!parsed || !Array.isArray(parsed.bans)) return null
    return {
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
      bans: parsed.bans.filter(
        (row): row is MirrorBan =>
          !!row &&
          typeof row.username === 'string' &&
          (row.type === 'normal' || row.type === 'ip'),
      ),
      banIps: Array.isArray(parsed.banIps)
        ? parsed.banIps.filter(
            (row): row is MirrorBanIp =>
              !!row && typeof row.ip === 'string' && typeof row.username === 'string',
          )
        : [],
    }
  } catch {
    return null
  }
}

/** Restore bans from the mirror when the Ban table is empty (lost db). */
async function restoreBansFromMirror(): Promise<void> {
  const target = bansMirrorPath()
  if (!target) return
  const count = await db.ban.count()
  if (count > 0) return
  const { readFileSync, existsSync } = await import('fs')
  if (!existsSync(target)) return
  const mirror = parseMirror(readFileSync(target, 'utf8'))
  if (!mirror || mirror.bans.length === 0) return

  const now = Date.now()
  let restored = 0
  for (const row of mirror.bans) {
    // Expired bans stay expired — same self-heal as the server auto-prune.
    if (row.expiresAt && Date.parse(row.expiresAt) <= now) continue
    try {
      await db.ban.create({
        data: {
          username: row.username,
          type: row.type,
          reason: row.reason,
          createdBy: row.createdBy,
          createdAt: new Date(row.createdAt),
          expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
        },
      })
      restored += 1
    } catch {
      // duplicate / malformed row — keep going
    }
  }
  const liveUsernames = new Set(
    (await db.ban.findMany({ select: { username: true } })).map((r) => r.username),
  )
  for (const row of mirror.banIps) {
    if (!liveUsernames.has(row.username)) continue
    try {
      // createMany({skipDuplicates}) is unreliable on SQLite — insert one by
      // one and let the primary key reject anything already present.
      await db.banIp.create({ data: { ip: row.ip, username: row.username } })
    } catch {
      // already frozen / malformed — best effort
    }
  }
  if (restored > 0) {
    console.log(
      `[db] restored ${restored} ban(s) from the mirror (${target}) after an empty Ban table`,
    )
  }
}

// --- Full-database mirror (auth + library survive republishes) --------------

/**
 * The site ships as a tarball that the platform unpacks OVER the previous
 * container state — and the packaging used to include this workspace's
 * db/custom.db, so every republish clobbered the live database with a stale
 * copy: every Session row died (all users signed out), guest accounts and
 * their libraries vanished. Two layers fix that:
 *
 *  1. The package no longer carries a db file. It carries a *seed mirror*
 *     (db/db-mirror-seed.json) generated from the workspace db at build time.
 *  2. At runtime the whole database is mirrored to db/db-mirror.json (never
 *     shipped, never committed) and restored when the db comes up fresh.
 *
 * Restore rule: only when the db is genuinely fresh (no accounts AND no
 * system keys) — a db that already has data always wins, so a surviving live
 * db is never downgraded to a stale mirror.
 */

const MIRROR_TABLES = [
  'account',
  'session',
  'playlist',
  'playlistTrack',
  'likedTrack',
  'playHistory',
  'announcement',
  'ban',
  'ipSeen',
  'banIp',
  'userSeen',
  'systemKey',
  'emailLog',
  'accountTrack',
  'accountPlaylist',
  'accountPlaylistItem',
] as const

/** FK-safe restore order (children after their parents). */
const RESTORE_ORDER: readonly string[] = [
  'account',
  'session',
  'playlist',
  'playlistTrack',
  'likedTrack',
  'playHistory',
  'announcement',
  'ban',
  'ipSeen',
  'banIp',
  'userSeen',
  'systemKey',
  'emailLog',
  'accountTrack',
  'accountPlaylist',
  'accountPlaylistItem',
]

function dbMirrorPath(): string | null {
  if (!sqliteFilePath) return null
  return resolve(dirname(sqliteFilePath), 'db-mirror.json')
}

function dbSeedMirrorPath(): string | null {
  if (!sqliteFilePath) return null
  return resolve(dirname(sqliteFilePath), 'db-mirror-seed.json')
}

interface DbMirror {
  savedAt: string
  tables: Record<string, unknown[]>
}

function parseDbMirror(raw: string): DbMirror | null {
  try {
    const parsed = JSON.parse(raw) as Partial<DbMirror> | null
    if (!parsed || typeof parsed.savedAt !== 'string') return null
    if (!parsed.tables || typeof parsed.tables !== 'object') return null
    const tables: Record<string, unknown[]> = {}
    for (const name of MIRROR_TABLES) {
      const rows = (parsed.tables as Record<string, unknown>)[name]
      tables[name] = Array.isArray(rows) ? rows : []
    }
    return { savedAt: parsed.savedAt, tables }
  } catch {
    return null
  }
}

/**
 * Read every mirrored table from the LIVE database and return the mirror
 * object in memory (no file I/O). Used by the deploy-time export endpoint
 * (GET /api/db-mirror/latest) so the platform build can package the
 * production state as the seed mirror — the piece that makes accounts,
 * sessions and libraries survive a deploy that recreates the container.
 */
export async function buildDbMirrorSnapshot(): Promise<DbMirror> {
  const tables: Record<string, unknown[]> = {}
  for (const name of MIRROR_TABLES) {
    tables[name] = await (db as unknown as Record<string, { findMany: () => Promise<unknown[]> }>)[name].findMany()
  }
  return {
    savedAt: new Date().toISOString(),
    tables,
  }
}

let mirrorTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Debounced best-effort full-database mirror write (trailing 2s). Call after
 * any mutation whose loss would hurt: auth (login/guest/register/refresh/
 * logout), library changes, ban updates. A timer also flushes every 60s as a
 * safety net for mutations without an explicit call.
 */
export function scheduleDbMirror(): void {
  if (mirrorTimer) return
  mirrorTimer = setTimeout(() => {
    mirrorTimer = null
    void refreshDbMirror()
  }, 2_000)
  if (typeof mirrorTimer.unref === 'function') mirrorTimer.unref()
}

/**
 * Dump every table into db/db-mirror.json (atomic, best-effort). Skips the
 * write when the db looks empty but an existing mirror holds accounts — a
 * transient empty read must never downgrade a good mirror.
 */
export async function refreshDbMirror(): Promise<void> {
  const target = dbMirrorPath()
  if (!target) return
  try {
    const tables: Record<string, unknown[]> = {}
    for (const name of MIRROR_TABLES) {
      tables[name] = await (db as unknown as Record<string, { findMany: () => Promise<unknown[]> }>)[name].findMany()
    }
    const looksEmpty =
      (tables.account as unknown[]).length === 0 &&
      (tables.session as unknown[]).length === 0 &&
      (tables.systemKey as unknown[]).length === 0
    if (looksEmpty) {
      const { existsSync } = await import('fs')
      if (existsSync(target)) return
    }
    const mirror: DbMirror = {
      savedAt: new Date().toISOString(),
      tables,
    }
    await writeJsonAtomic(target, mirror)
  } catch (err) {
    console.warn('[db] db-mirror write failed (best-effort):', err)
  }
}

/**
 * Restore the whole database from the mirror when the db came up fresh
 * (provisioned by the DDL self-healing, no accounts, no system keys).
 * Prefers the runtime mirror; falls back to the package's seed mirror.
 */
async function restoreDbFromMirror(): Promise<void> {
  const { existsSync, readFileSync } = await import('fs')
  const [accounts, keys] = await Promise.all([
    db.account.count(),
    db.systemKey.count(),
  ])
  if (accounts > 0 || keys > 0) return

  const candidates = [dbMirrorPath(), dbSeedMirrorPath()]
  let mirror: DbMirror | null = null
  let source = ''
  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue
    try {
      const parsed = parseDbMirror(readFileSync(candidate, 'utf8'))
      // Accept a mirror that carries accounts OR system keys — a production
      // state can legitimately have zero accounts yet hold the owner's
      // maintenance switch / admin-gate secret, which must survive too.
      if (
        parsed &&
        ((parsed.tables.account as unknown[]).length > 0 ||
          (parsed.tables.systemKey as unknown[]).length > 0)
      ) {
        mirror = parsed
        source = candidate
        break
      }
    } catch {
      // unreadable mirror — try the next candidate
    }
  }
  if (!mirror) return

  let restored = 0
  for (const name of RESTORE_ORDER) {
    const rows = mirror.tables[name]
    if (!rows || rows.length === 0) continue
    const delegate = (db as unknown as Record<string, { createMany: (a: { data: unknown[] }) => Promise<{ count: number }> }>)[name]
    try {
      const result = await delegate.createMany({ data: rows })
      restored += result.count
    } catch {
      // batch rejected (shape drift / duplicate) — insert row by row so one
      // bad row cannot drop the whole table
      let ok = 0
      for (const row of rows) {
        try {
          await delegate.createMany({ data: [row] })
          ok += 1
        } catch {
          // skip malformed row
        }
      }
      restored += ok
    }
  }
  if (restored > 0) {
    console.log(
      `[db] restored ${restored} row(s) from the database mirror (${source}, savedAt ${mirror.savedAt}) after a fresh db`,
    )
    await refreshDbMirror()
  }
}

/**
 * Validate raw JSON text as a full-database mirror. Exported for the restore
 * endpoint, which must never replace live production state with a malformed
 * or empty payload — a mirror has to carry at least one account or one
 * system key to be accepted (same rule the build's seed validation uses).
 */
export function parseDbMirrorPayload(raw: string): DbMirror | null {
  const parsed = parseDbMirror(raw);
  if (!parsed) return null;
  const hasState =
    (parsed.tables.account as unknown[]).length > 0 ||
    (parsed.tables.systemKey as unknown[]).length > 0;
  return hasState ? parsed : null;
}

/**
 * Replace the contents of every mirrored table with the rows from `mirror`.
 *
 * WHY THIS EXISTS: the seed-mirror round-trip protects data going *into* a
 * deploy, but once a bad seed has shipped (the historical workspace-fallback
 * bug that wiped user accounts and echoed E2E test accounts into
 * production), there was no way to repair the LIVE server short of another
 * deploy. This is the owner's recovery tool: POST a known-good mirror
 * (fetched via /api/db-mirror/latest, optionally cleaned) and production
 * state is restored in place.
 *
 * Semantics: full REPLACE, not merge — rows absent from the mirror are
 * deleted (deletes run in reverse FK order, inserts in RESTORE_ORDER).
 * Caller is responsible for the key gate; this function is unfailingly
 * destructive. The runtime db-mirror.json is refreshed afterwards so the
 * next boot can't resurrect the replaced state from a stale mirror file.
 */
export async function replaceDbFromMirrorObject(
  mirror: DbMirror,
): Promise<{ restored: number; deleted: number; tables: Record<string, number> }> {
  await ensureDbReady();

  let deleted = 0;
  for (const name of [...RESTORE_ORDER].reverse()) {
    const delegate = (db as unknown as Record<
      string,
      { deleteMany: () => Promise<{ count: number }> }
    >)[name];
    try {
      const result = await delegate.deleteMany();
      deleted += result.count;
    } catch (err) {
      console.warn(`[db] mirror restore: deleteMany(${name}) failed:`, err);
    }
  }

  let restored = 0;
  const tables: Record<string, number> = {};
  for (const name of RESTORE_ORDER) {
    const rows = mirror.tables[name] ?? [];
    tables[name] = 0;
    if (rows.length === 0) continue;
    const delegate = (db as unknown as Record<
      string,
      { createMany: (a: { data: unknown[] }) => Promise<{ count: number }> }
    >)[name];
    let ok = 0;
    try {
      const result = await delegate.createMany({ data: rows });
      ok = result.count;
    } catch {
      // batch rejected (shape drift / duplicate) — insert row by row so one
      // bad row cannot drop the whole table
      for (const row of rows) {
        try {
          await delegate.createMany({ data: [row] });
          ok += 1;
        } catch {
          // skip malformed row
        }
      }
    }
    tables[name] = ok;
    restored += ok;
  }

  console.log(
    `[db] mirror restore replaced state: deleted ${deleted} row(s), restored ${restored} row(s) (savedAt ${mirror.savedAt})`,
  );
  await refreshDbMirror();
  return { restored, deleted, tables };
}

// --- ensureDbReady ----------------------------------------------------------

let readyPromise: Promise<boolean> | null = null

/**
 * Idempotent, single-flight boot sequence: provision any missing tables, then
 * restore the bans mirror if the Ban table came up empty. Never rejects —
 * callers can simply `await ensureDbReady()` and continue.
 */
export function ensureDbReady(): Promise<boolean> {
  if (!readyPromise) {
    readyPromise = (async () => {
      try {
        for (const ddl of SCHEMA_DDL) {
          try {
            await db.$executeRawUnsafe(ddl)
          } catch (err) {
            // One failing statement (e.g. odd pre-existing table shape) must
            // not stop the others.
            console.warn('[db] ensure-schema statement failed:', err)
          }
        }
        await migrateColumns()
        await restoreBansFromMirror()
        await restoreDbFromMirror()
        return true
      } catch (err) {
        console.warn('[db] ensure-schema failed:', err)
        return false
      }
    })()
  }
  return readyPromise
}

// Kick it off at import time so every route benefits from a provisioned db
// without waiting for the moderation lib.
void ensureDbReady()

// safety net: flush the database mirror even for mutations that never call
// scheduleDbMirror explicitly (library edits, play history, email logs...)
if (typeof setInterval === 'function') {
  const mirrorInterval = setInterval(() => {
    void refreshDbMirror()
  }, 60_000)
  if (typeof mirrorInterval.unref === 'function') mirrorInterval.unref()
}
