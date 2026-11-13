import crypto from "node:crypto";
import { sessionSecret } from "@/lib/websiteCookie";

/**
 * Stateless account-recovery tokens — the permanent fix for the recurring
 * "logged out and told to create an account" cycle.
 *
 * WHY THIS EXISTS: every platform Deploy recreates the FC container and the
 * live SQLite database dies with it. Production state is rebuilt from the
 * deploy-time seed mirror, whose chain (live fetch -> cached export ->
 * sanitized workspace seed) has repeatedly failed after workspace resets —
 * the key went stale, the cache file was wiped — and every failure seeded an
 * EMPTY production: every Session row gone, /api/auth/me 401 for everyone,
 * the client dropped users on the "create an account" onboarding and their
 * server-side likes/playlists vanished.
 *
 * THE FIX: the durable copy of an identity lives in the USER'S BROWSER, not
 * only on the server. Each session-issuing response carries a recovery
 * token; the client caches it (plus the profile and the liked library) and,
 * whenever its session is definitively dead, POSTs the bundle to
 * POST /api/auth/recover — which re-signs the user in, or rebuilds the
 * Account row from the cached profile if the database was wiped. Liked
 * tracks are re-pushed from the client cache right after. A wiped server
 * therefore heals itself as users return: no onboarding wizard, no
 * re-registration, no duplicate accounts, library restored.
 *
 * TOKEN DESIGN (wrc2): the token carries one HMAC-SHA256 segment per
 * verification secret, joined with "."; verification accepts ANY segment:
 *   segment A = HMAC(S2, "recovery:<accountId>"), where
 *     S2 = sha256("liner-account-recovery-v1:" + DB_MIRROR_EXPORT_KEY)
 *     (deterministic from the env the build traces into every container —
 *      survives a TOTAL database wipe, including the SystemKey table)
 *   segment B = HMAC(S1, "recovery:<accountId>"), where
 *     S1 = the SystemKey "website_session_secret" (survives mirror restores
 *          and the sanitized deploy seed, which keeps every systemKey row —
 *          covers a ROTATED deploy key)
 * A token keeps working as long as EITHER secret chain is intact, so a
 * wiped SystemKey table and a rotated deploy key each leave recovery alive.
 * Verification is constant-time per candidate; the endpoint treats every
 * failure the same (no account-id enumeration).
 */

const S2_CONTEXT = "liner-account-recovery-v1";
const TOKEN_PREFIX = "wrc2_";
const HEX_64 = /^[0-9a-f]{64}$/;

function mac(secret: Buffer, accountId: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`recovery:${accountId}`)
    .digest("hex");
}

function envDerivedSecret(): Buffer | null {
  const key = process.env.DB_MIRROR_EXPORT_KEY?.trim();
  if (!key) return null;
  return crypto
    .createHash("sha256")
    .update(`${S2_CONTEXT}:${key}`)
    .digest();
}

async function systemKeySecret(): Promise<Buffer | null> {
  try {
    return await sessionSecret();
  } catch {
    // db unavailable — the env-derived secret still stands
    return null;
  }
}

/** The recovery token for an account (stable for the account's lifetime). */
export async function recoveryTokenFor(accountId: string): Promise<string> {
  const segments: string[] = [];
  const derived = envDerivedSecret();
  if (derived) segments.push(mac(derived, accountId));
  const systemKey = await systemKeySecret();
  if (systemKey) segments.push(mac(systemKey, accountId));
  // with neither secret configured recovery is simply not armed — still
  // return a well-formed token so callers stay shape-stable
  if (segments.length === 0) segments.push("0".repeat(64));
  return `${TOKEN_PREFIX}${segments.join(".")}`;
}

/**
 * Check a presented recovery token: valid when ANY of its segments matches
 * ANY of the verification secrets (S2 first — it is the one that survives a
 * total database wipe).
 */
export async function verifyRecoveryToken(
  accountId: string,
  token: string,
): Promise<boolean> {
  if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX)) return false;
  const segments = token
    .slice(TOKEN_PREFIX.length)
    .split(".")
    .filter((s) => HEX_64.test(s));
  if (segments.length === 0) return false;

  const candidateSecrets: Buffer[] = [];
  const derived = envDerivedSecret();
  if (derived) candidateSecrets.push(derived);
  const systemKey = await systemKeySecret();
  if (systemKey) candidateSecrets.push(systemKey);

  for (const secret of candidateSecrets) {
    const expected = Buffer.from(mac(secret, accountId), "hex");
    for (const segment of segments) {
      const presented = Buffer.from(segment, "hex");
      if (
        presented.length === expected.length &&
        crypto.timingSafeEqual(presented, expected)
      ) {
        return true;
      }
    }
  }
  return false;
}
