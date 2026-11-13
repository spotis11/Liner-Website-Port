// Liner Pro overlay for relayed upstream Liner users.
//
// The upstream-parity switch (v1.25) signs users in against the REAL Liner
// API (api.tryliner.fun). Their /v1/me comes from upstream and carries the
// upstream's own idea of Pro — which this website port's owner (jayzeyluna)
// and its owner-granted accounts do not have there. This website's own Pro
// bookkeeping (src/lib/pro.ts: the owner is Pro forever, everyone else by an
// explicit owner grant on the Account row) must therefore ride on top:
// whenever a relayed upstream response embeds a Liner user, the website's
// flag upgrades `isPro` — never downgrades a real upstream Pro.
import { isOwnerPro } from "@/lib/pro";
import { db } from "@/lib/db";

/** True when this username holds Liner Pro on this website port. */
async function websitePro(username: string): Promise<boolean> {
  if (isOwnerPro(username)) return true;
  try {
    const row = await db.account.findUnique({
      where: { username },
      select: { isPro: true },
    });
    return Boolean(row?.isPro);
  } catch {
    return false;
  }
}

/**
 * Upgrade `isPro` on a relayed upstream JSON body when it carries a Liner
 * user. Handles both shapes the SPA consumes: a bare user object (GET /v1/me,
 * PATCH /v1/users/me) and an auth envelope ({user: ...} inside login /
 * register / refresh responses). Non-user JSON passes through untouched.
 */
export async function overlayWebsitePro(
  body: ArrayBuffer,
  contentType: string | null,
): Promise<ArrayBuffer> {
  if (!contentType?.includes("application/json") || body.byteLength === 0) {
    return body;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return body;
  }
  if (!parsed || typeof parsed !== "object") return body;
  const record = parsed as Record<string, unknown>;
  const user =
    record.user && typeof record.user === "object"
      ? (record.user as Record<string, unknown>)
      : record;
  const username = user?.username;
  if (typeof username !== "string" || !username) return body;
  if (!(await websitePro(username))) return body;
  const upgraded =
    user === record
      ? { ...record, isPro: true }
      : {
          ...record,
          user: { ...(record.user as Record<string, unknown>), isPro: true },
        };
  return new TextEncoder().encode(JSON.stringify(upgraded)).buffer as ArrayBuffer;
}
