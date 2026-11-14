import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/discord-bot/status — public web visibility for the workspace's
 * Discord bots (24/7, supervisor + watchdog self-healing).
 *
 * Each runner writes a bot_status.json with a 15s heartbeat; this route
 * reports a bot as online only while the heartbeat is fresh (<90s), so a
 * dead process never shows as online. Server identity fields (guild list)
 * are intentionally NOT exposed — only liveness + basic identity.
 *
 * Reports the primary bot (Liner System, liner-bot/) when fresh, falling back
 * to the legacy Alfredo runner (discord-bot/) when only that is alive. When
 * neither runs (e.g. production FC), returns online:false instead of
 * erroring.
 */
export async function GET() {
  const candidates = [
    { dir: "/home/z/my-project/liner-bot", kind: "liner-system" },
    { dir: "/home/z/my-project/discord-bot", kind: "alfredo" },
  ];
  for (const { dir, kind } of candidates) {
    const status = readBotStatus(dir);
    if (status) {
      return NextResponse.json(
        { ...status, kind },
        { headers: { "cache-control": "no-store" } },
      );
    }
  }
  return NextResponse.json(
    {
      online: false,
      status: "not_running",
      bot: null,
      guildCount: null,
      kind: "none",
    },
    { headers: { "cache-control": "no-store" } },
  );
}

function readBotStatus(dir: string):
  | {
      online: boolean;
      status: string;
      bot: string | null;
      guildCount: number | null;
      startedAt: string | null;
      lastReadyAt: string | null;
      heartbeatAgeSec: number | null;
    }
  | null {
  try {
    if (!existsSync(`${dir}/bot_status.json`)) return null;
    const raw = readFileSync(`${dir}/bot_status.json`, "utf8");
    const s = JSON.parse(raw) as {
      status?: string;
      pid?: number;
      started_at?: string | null;
      last_ready_at?: string | null;
      bot_username?: string | null;
      guild_count?: number;
      heartbeat?: string;
    };

    const heartbeatAgeMs = s.heartbeat
      ? Date.now() - new Date(s.heartbeat).getTime()
      : Number.POSITIVE_INFINITY;
    const online = s.status === "online" && heartbeatAgeMs < 90_000;
    if (!online) return null;

    return {
      online,
      status: s.status ?? "unknown",
      bot: s.bot_username ?? null,
      guildCount: typeof s.guild_count === "number" ? s.guild_count : null,
      startedAt: s.started_at ?? null,
      lastReadyAt: s.last_ready_at ?? null,
      heartbeatAgeSec:
        Number.isFinite(heartbeatAgeMs) && heartbeatAgeMs >= 0
          ? Math.round(heartbeatAgeMs / 1000)
          : null,
    };
  } catch {
    return null;
  }
}
