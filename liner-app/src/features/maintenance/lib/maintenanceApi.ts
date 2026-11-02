/**
 * Website-port maintenance API.
 *
 * Talks to the website port's own backend (same-origin Next.js routes), NOT
 * to api.tryliner.fun — exactly like the moderation API. Maintenance is a
 * website-port-only feature; the upstream Liner API knows nothing about it.
 */

export interface MaintenanceStatus {
  enabled: boolean;
  /** Human-readable reasons rendered on the maintenance screen. */
  reasons: string[];
  updatedAt: string;
}

export type MaintenanceErrorCode =
  | "unauthorized"
  | "forbidden"
  | "invalid_enabled"
  | "generic";

export class MaintenanceError extends Error {
  constructor(
    public code: MaintenanceErrorCode,
    public status: number,
  ) {
    super(`maintenance error: ${code} (${status})`);
    this.name = "MaintenanceError";
  }
}

function parseStatus(data: unknown): MaintenanceStatus {
  const d = (data ?? {}) as Partial<MaintenanceStatus>;
  return {
    enabled: d.enabled === true,
    reasons: Array.isArray(d.reasons)
      ? d.reasons.filter((r): r is string => typeof r === "string" && r.trim().length > 0)
      : [],
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : "",
  };
}

/**
 * Public boot probe. ALWAYS answers 200 server-side — even while the wall
 * is up — because this response is what raises and releases the client
 * wall. Transport failures throw; the gate decides what that means.
 */
export async function fetchMaintenanceStatus(
  timeoutMs = 8_000,
): Promise<MaintenanceStatus> {
  const res = await fetch("/api/maintenance", {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new MaintenanceError("generic", res.status);
  return parseStatus(await res.json());
}

async function setRequest(
  enabled: boolean,
  reasons: string[] | undefined,
  accessToken: string | null,
  timeoutMs: number,
): Promise<MaintenanceStatus> {
  const res = await fetch("/api/maintenance", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ enabled, ...(reasons ? { reasons } : {}) }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    if (res.status === 401) throw new MaintenanceError("unauthorized", 401);
    if (res.status === 403) throw new MaintenanceError("forbidden", 403);
    throw new MaintenanceError("generic", res.status);
  }
  return parseStatus(await res.json());
}

/**
 * Owner switch: enable/disable the wall (site owner only — the token is
 * verified server-side, with the website admin cookie as the fallback
 * credential, exactly like the moderation endpoints).
 */
export async function setMaintenanceRemote(
  enabled: boolean,
  reasons: string[] | undefined,
  accessToken: string | null,
  timeoutMs = 15_000,
): Promise<MaintenanceStatus> {
  try {
    return await setRequest(enabled, reasons, accessToken, timeoutMs);
  } catch (err) {
    if (err instanceof MaintenanceError && err.code === "unauthorized") {
      const { refreshAuthSession } = await import("@/shared/api/auth-session");
      const refreshed = await refreshAuthSession().catch(() => null);
      const nextToken = refreshed?.accessToken ?? accessToken;
      if (nextToken) {
        return setRequest(enabled, reasons, nextToken, timeoutMs);
      }
    }
    throw err;
  }
}
