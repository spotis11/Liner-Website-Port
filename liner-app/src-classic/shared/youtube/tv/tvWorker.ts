import { InnertubeError } from "../innertube/innertubeClient";

export interface TvSession {
  poToken: string;
  livingRoomPoTokenId: string;
  visitorData: string;
  clientVersion: string;
  playerId: string;
}

export interface TvSolveResult {
  signatureTimestamp: number;
  values: string[];
}

function electronApi() {
  const api = typeof window === "undefined" ? undefined : window.linerElectron;
  const hasTv =
    typeof api?.youtubeTvSession === "function" &&
    typeof api.youtubeSolveN === "function";
  return hasTv ? api : null;
}

// desktop: the native layer bootstraps the TV session (hidden-window
// BotGuard) and solves n-challenges in the main process.
// website port: the shell bootstraps the TV session server-side
// (src/app/api/youtube/tv-session) and n-challenges are solved right here in
// the browser (./nSolver) — a real browser realm is exactly what the player
// script wants, mirroring the desktop renderer behaviour.

export async function getTvSession(): Promise<TvSession> {
  const api = electronApi();
  if (api) return api.youtubeTvSession();
  const response = await fetch("/api/youtube/tv-session");
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new InnertubeError(
      body?.error || `TV session bootstrap failed (${response.status})`,
      502,
    );
  }
  return (await response.json()) as TvSession;
}

export async function solveTvN(
  playerId: string,
  values: string[],
): Promise<TvSolveResult> {
  const api = electronApi();
  if (api) return api.youtubeSolveN(playerId, values);
  const { solveN } = await import("./nSolver");
  return solveN(playerId, values);
}
