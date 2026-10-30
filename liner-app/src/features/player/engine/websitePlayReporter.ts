// Website-port play reporter — feeds the site owner's User Finder.
//
// Every time a track actually STARTS playing on the website, this posts a
// one-line record to the website's own backend (/api/history) together with
// the signed-in username, so the owner can see which account played which
// song. The desktop app has no such feature — upstream Liner history lives
// per-account behind /v1/me and is not readable for other users.
//
// Fire-and-forget by design: playback must never wait on (or break because
// of) this. Failures are swallowed; the endpoint is same-origin and cheap.

import { log } from "@/shared/utils/logger";
import type { Track } from "@/shared/types/track";

interface ReportPayload {
  track: {
    id: string;
    source?: string;
    title: string;
    artist: string;
    artwork?: string | null;
    duration?: number;
  };
  username?: string;
}

function signedInUsername(): string | undefined {
  try {
    // localAccount.username is written by the auth store on sign-in; reading
    // the localStorage session keeps the player engine decoupled from it
    const raw = localStorage.getItem("liner_auth_session");
    if (!raw) return undefined;
    const session = JSON.parse(raw) as {
      user?: { username?: string | null };
    };
    const username = session?.user?.username;
    return typeof username === "string" && username.trim()
      ? username.trim().toLowerCase()
      : undefined;
  } catch {
    return undefined;
  }
}

/** Fire-and-forget play report; never throws, never blocks playback. */
export function reportWebsitePlay(track: Track): void {
  try {
    if (typeof fetch !== "function") return;
    if (!track?.id || !track.title) return;
    // local files never leave the device — do not report them
    if (track.localFileId) return;
    const payload: ReportPayload = {
      track: {
        id: track.id,
        title: track.title,
        artist: track.artists ?? "Unknown",
        artwork: track.coverUrl || null,
        duration: track.durationMs
          ? Math.round(track.durationMs / 1000)
          : undefined,
      },
      username: signedInUsername(),
    };
    fetch("/api/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // silently ignore — reporting is best effort
    });
  } catch (error) {
    log("yellow", "playback", `play report skipped: ${String(error)}`);
  }
}
