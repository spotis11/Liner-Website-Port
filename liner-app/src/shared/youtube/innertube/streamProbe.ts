import { InnertubeError } from "./innertubeClient";
import { BOT_CHECK_PATTERN } from "../auth/signInRequest";

const PROBE_OFFSET = 1_048_576 + 4096;
const REJECTED_PREFIX = "stream url rejected with";

/** googlevideo answered 403 to a stream url it handed out: the network is refused, not the track */
export function isStreamRefused(error: unknown): boolean {
  return (
    error instanceof InnertubeError &&
    error.status === 403 &&
    error.message.startsWith(REJECTED_PREFIX)
  );
}

/**
 * the player request itself answered LOGIN_REQUIRED "Sign in to confirm
 * you're not a bot": YouTube refuses the whole network (datacenter egress)
 * for that video on every client — again a network refusal, not a dead track.
 * Counted like isStreamRefused so the user gets the "YouTube refused every
 * audio stream from this network" message instead of a raw failure dump.
 */
export function isBotCheckRefusal(error: unknown): boolean {
  return (
    error instanceof InnertubeError &&
    error.status === 403 &&
    BOT_CHECK_PATTERN.test(error.message)
  );
}

export async function assertStreamReachable(
  url: string,
  contentLength: number | undefined,
  signal?: AbortSignal,
): Promise<void> {
  const probe = new URL(url);
  const offset =
    contentLength && contentLength > PROBE_OFFSET ? PROBE_OFFSET : 0;
  probe.searchParams.set("range", `${offset}-${offset}`);
  const response = await fetch(probe.toString(), { signal });
  await response.body?.cancel().catch(() => undefined);
  if (!response.ok)
    throw new InnertubeError(
      `${REJECTED_PREFIX} ${response.status}`,
      response.status,
    );
}
