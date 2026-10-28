import { NextRequest, NextResponse } from "next/server";
import { authenticateAdmin } from "@/lib/adminGate";
import { db, ensureDbReady } from "@/lib/db";
import { MODERATION_ADMIN_USERNAME, normalizeUsername } from "@/lib/moderation";
import {
  fetchUpstreamUserHistory,
  resolveUpstreamUser,
  upstreamHistoryToSong,
  type UpstreamUser,
} from "@/lib/linerUsers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Website-port User Finder — SITE OWNER ONLY (@jayzeyluna).
 *
 * Given a Liner username, returns everything the owner can legitimately see:
 *  - LIVE upstream profile via the desktop app's own user-directory API
 *    (GET /v1/users/:idOrUsername, /v1/users/search, /v1/users/:id/history),
 *    called with the owner's own Bearer token — this works for ANY Liner
 *    account whether or not it ever visited this website, and provides the
 *    avatar, account creation date, follower counts and (when the account's
 *    privacy allows) their Liner play history
 *  - website-side knowledge (UserSeen / PlayHistory / IpSeen / bans): last
 *    seen HERE, last network address, songs played on THIS website
 *
 * When the upstream directory is unavailable (dead token / upstream 404) the
 * response degrades to the website cache with profileSource: "cache".
 *
 * Authentication: the same gate as moderation/announcements — a live
 * upstream-verified owner Bearer token OR the website admin cookie.
 */

/** e2e harness tokens must never reach the upstream API. */
function extractLinerToken(req: NextRequest): string | null {
  const raw = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!raw || raw.startsWith("e2e-")) return null;
  return raw;
}

function upstreamToProfile(upstream: UpstreamUser, username: string) {
  return {
    // the directory keys profiles by id; carry the searched name as the
    // canonical username when upstream omits it
    username: (upstream.username ?? username).toLowerCase(),
    email: upstream.email ?? null,
    userId: upstream.id ?? null,
    displayName: upstream.displayName ?? null,
    avatarUrl: upstream.avatarUrl ?? null,
    bio: upstream.bio ?? null,
    accountCreatedAt: upstream.createdAt ?? null,
    followersCount: typeof upstream.followersCount === "number" ? upstream.followersCount : null,
    followingCount: typeof upstream.followingCount === "number" ? upstream.followingCount : null,
    isPublic: typeof upstream.isPublic === "boolean" ? upstream.isPublic : null,
  };
}

export async function GET(req: NextRequest) {
  const auth = await authenticateAdmin(
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""),
    req,
  );
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.reason },
      { status: auth.status },
    );
  }

  await ensureDbReady();

  const url = new URL(req.url);
  const username = normalizeUsername(url.searchParams.get("username"));
  if (!username) {
    return NextResponse.json(
      { error: "invalid_username" },
      { status: 400 },
    );
  }

  const linerToken = extractLinerToken(req);

  try {
    // ---- live upstream lookup (any Liner account) ----
    let upstream: UpstreamUser | null = null;
    if (linerToken) {
      upstream = await resolveUpstreamUser(username, linerToken).catch(
        () => null,
      );
    }
    const upstreamProfile = upstream ? upstreamToProfile(upstream, username) : null;

    // ---- website-side knowledge ----
    const [profile, history, bans, ipSeen, banIps] = await Promise.all([
      db.userSeen.findUnique({ where: { username } }),
      db.playHistory.findMany({
        where: { username },
        orderBy: { playedAt: "desc" },
        take: 40,
      }),
      db.ban.findMany({ where: { username }, orderBy: { createdAt: "desc" } }),
      // IpSeen is keyed by ip — the same account can appear from several
      // addresses; the newest sighting is the "last network address"
      db.ipSeen
        .findFirst({
          where: { username },
          orderBy: { updatedAt: "desc" },
        })
        .catch(() => null),
      db.banIp.findMany({ where: { username }, orderBy: { createdAt: "desc" } }),
    ]);

    if (!upstreamProfile && !profile && history.length === 0 && bans.length === 0 && !ipSeen) {
      return NextResponse.json({ found: false, username });
    }

    const now = Date.now();
    const activeBan =
      bans.find(
        (ban) => !ban.expiresAt || ban.expiresAt.getTime() > now,
      ) ?? null;

    // ---- recent songs: upstream Liner history first, then this website's ----
    let upstreamSongs: Awaited<ReturnType<typeof upstreamHistoryToSong>>[] = [];
    if (upstream) {
      const historyId = upstream.username || upstream.id;
      if (historyId) {
        const items = await fetchUpstreamUserHistory(
          historyId,
          linerToken ?? "",
          15,
        ).catch(() => null);
        upstreamSongs = (items ?? [])
          .map(upstreamHistoryToSong)
          .filter(
            (song): song is NonNullable<typeof song> => song !== null,
          );
      }
    }

    // de-duplicate consecutive repeats of the same track
    const seen = new Set<string>();
    const websiteSongs = history
      .filter((row) => {
        const key = `${row.source}:${row.trackId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 15)
      .map((row) => ({
        title: row.title,
        artist: row.artist,
        artwork: row.artwork,
        duration: row.duration,
        source: row.source,
        playedAt: row.playedAt.toISOString(),
      }));

    const songKey = (song: { title: string; artist: string }) =>
      `${song.title.toLowerCase()}|${song.artist.toLowerCase()}`;
    const upstreamKeys = new Set(upstreamSongs.map(songKey));
    const recentSongs = [...upstreamSongs, ...websiteSongs]
      .filter((song, index, all) => {
        const key = `${song.source}:${songKey(song)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        // a website row duplicating a fresher upstream row is dropped too
        if (
          song.source !== "liner" &&
          upstreamKeys.has(songKey(song))
        ) {
          return false;
        }
        void index;
        return true;
      })
      .sort((a, b) => (a.playedAt < b.playedAt ? 1 : -1))
      .slice(0, 15);

    return NextResponse.json({
      found: true,
      username,
      profileSource: upstreamProfile ? "upstream" : "cache",
      profile: upstreamProfile
        ? {
            ...upstreamProfile,
            firstSeenAt: profile?.firstSeenAt.toISOString() ?? null,
            lastSeenAt: profile?.lastSeenAt.toISOString() ?? null,
          }
        : profile
          ? {
              username,
              email: profile.email,
              userId: profile.userId,
              displayName: profile.displayName,
              avatarUrl: profile.avatarUrl,
              bio: profile.bio,
              accountCreatedAt: profile.accountCreatedAt?.toISOString() ?? null,
              followersCount: null,
              followingCount: null,
              isPublic: null,
              firstSeenAt: profile.firstSeenAt.toISOString(),
              lastSeenAt: profile.lastSeenAt.toISOString(),
            }
          : null,
      recentSongs,
      ban: activeBan
        ? {
            type: activeBan.type,
            reason: activeBan.reason,
            createdAt: activeBan.createdAt.toISOString(),
            expiresAt: activeBan.expiresAt?.toISOString() ?? null,
          }
        : null,
      banHistoryCount: bans.length,
      lastIp: ipSeen
        ? { ip: ipSeen.ip, updatedAt: ipSeen.updatedAt.toISOString() }
        : null,
      frozenIps: banIps.map((row) => ({
        ip: row.ip,
        createdAt: row.createdAt.toISOString(),
      })),
      isAdminAccount: username === MODERATION_ADMIN_USERNAME,
    });
  } catch (err) {
    console.error("[userfinder] lookup failed:", err);
    return NextResponse.json(
      { error: "lookup_failed" },
      { status: 500 },
    );
  }
}
