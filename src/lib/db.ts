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
]

// Column additions for pre-existing tables: SQLite has no ADD COLUMN IF NOT
// EXISTS, so each migration checks pragma table_info first (boot-time, cheap).
async function migrateColumns(): Promise<void> {
  const needed = [
    { table: 'PlayHistory', column: 'username', ddl: 'ALTER TABLE "PlayHistory" ADD COLUMN "username" TEXT' },
  ] as const
  for (const { table, column, ddl } of needed) {
    try {
      const rows = await db.$queryRawUnsafe<{ name: string }[]>(
        `PRAGMA table_info("${table}")`,
      )
      if (Array.isArray(rows) && !rows.some((row) => row.name === column)) {
        await db.$executeRawUnsafe(ddl)
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
