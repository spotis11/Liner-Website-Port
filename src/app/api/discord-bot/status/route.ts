import { NextResponse } from "next/server";
import { readFileSync } from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/discord-bot/status — public web visibility for the Alfredo
 * Discord bot runner (headless, 24/7 supervisor in discord-bot/).
 *
 * The runner writes discord-bot/bot_status.json with a 15s heartbeat; this
 * route reports it as online only while the heartbeat is fresh (<90s), so a
 * dead process never shows as online. Server identity fields (guild list)
 * are intentionally NOT exposed — only liveness + basic identity.
 *
 * On hosts where the runner doesn't exist (e.g. production FC without the
 * bot), this returns online:false with a reason instead of erroring.
 */
export async function GET() {
  try {
    const raw = readFileSync(
      "/home/z/my-project/discord-bot/bot_status.json",
      "utf8",
    );
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

    return NextResponse.json(
      {
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
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { online: false, status: "not_running", bot: null, guildCount: null },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
