/**
 * Website-port showcase API.
 *
 * Talks to the website port's own backend (same-origin Next.js routes), NOT
 * to api.tryliner.fun — exactly like the moderation and maintenance APIs.
 * Showcase is a website-port-only feature; the upstream Liner API knows
 * nothing about it.
 */

export interface ShowcaseStatus {
  enabled: boolean;
  updatedAt: string;
}

export type ShowcaseErrorCode = "unauthorized" | "forbidden" | "invalid_enabled" | "generic";

export class ShowcaseError extends Error {
  constructor(
    public code: ShowcaseErrorCode,
    public status: number,
  ) {
    super(`showcase error: ${code} (${status})`);
    this.name = "ShowcaseError";
  }
}

function parseStatus(data: unknown): ShowcaseStatus {
  const d = (data ?? {}) as Partial<ShowcaseStatus>;
  return {
    enabled: d.enabled === true,
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : "",
  };
}

/**
 * Public boot probe. Always answers 200 server-side — this response is
 * what starts and stops the name scramble on every open client.
 */
export async function fetchShowcaseStatus(
  timeoutMs = 8_000,
): Promise<ShowcaseStatus> {
  const res = await fetch("/api/showcase", {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new ShowcaseError("generic", res.status);
  return parseStatus(await res.json());
}

async function setRequest(
  enabled: boolean,
  accessToken: string | null,
  timeoutMs: number,
): Promise<ShowcaseStatus> {
  const res = await fetch("/api/showcase", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ enabled }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    if (res.status === 401) throw new ShowcaseError("unauthorized", 401);
    if (res.status === 403) throw new ShowcaseError("forbidden", 403);
    throw new ShowcaseError("generic", res.status);
  }
  return parseStatus(await res.json());
}

/**
 * Owner switch: enable/disable the showcase mode (site owner only — the
 * token is verified server-side, with the website admin cookie as the
 * fallback credential, exactly like the moderation and maintenance
 * endpoints).
 */
export async function setShowcaseRemote(
  enabled: boolean,
  accessToken: string | null,
  timeoutMs = 15_000,
): Promise<ShowcaseStatus> {
  try {
    return await setRequest(enabled, accessToken, timeoutMs);
  } catch (err) {
    if (err instanceof ShowcaseError && err.code === "unauthorized") {
      const { refreshAuthSession } = await import("@/shared/api/auth-session");
      const refreshed = await refreshAuthSession().catch(() => null);
      const nextToken = refreshed?.accessToken ?? accessToken;
      if (nextToken) {
        return setRequest(enabled, nextToken, timeoutMs);
      }
    }
    throw err;
  }
}
