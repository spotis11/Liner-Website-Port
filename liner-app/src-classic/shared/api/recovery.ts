import type { AuthTokens, AuthUser } from "../contracts";

/**
 * Client half of the account-recovery protocol — the permanent fix for the
 * recurring "logged out and told to create an account" cycle.
 *
 * Every deploy recreates the server container and its database; when the
 * deploy-time seed mirror chain fails (it did repeatedly after workspace
 * resets), production boots empty: sessions gone, accounts gone, likes gone
 * and every user lands on the "create an account" onboarding.
 *
 * The durable copy of an identity therefore lives in the USER'S BROWSER:
 * this module persists a small "recovery bundle" (recovery token + cached
 * profile) in its own localStorage key that is deliberately NOT cleared by
 * dead-session drops — only by an explicit sign-out (or a ban wall). When
 * the session is definitively dead, the auth store calls recoverAccount()
 * which POSTs the bundle to POST /api/auth/recover: the server re-signs the
 * user in, or rebuilds the wiped Account row from the cached profile. The
 * liked library is re-pushed right after from useLikedTracks' local cache.
 *
 * SECURITY: the bundle grants the same power as the refresh token it lives
 * next to in localStorage — same origin, same threat model, no new
 * exposure. It is cleared on logout/ban so a shared computer never
 * auto-reconnects a signed-out account.
 */

const STORAGE_KEY = "liner_account_recovery_v1";

export interface RecoveryBundle {
  accountId: string;
  username: string;
  recoveryToken: string;
  user: AuthUser;
  savedAt: string;
}

function readBundle(): RecoveryBundle | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecoveryBundle | null;
    if (
      !parsed ||
      typeof parsed.accountId !== "string" ||
      typeof parsed.recoveryToken !== "string" ||
      !parsed.recoveryToken
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeBundle(bundle: RecoveryBundle | null): void {
  if (typeof window === "undefined") return;
  try {
    if (bundle) localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage full / disabled — recovery is best-effort
  }
}

export function getRecoveryBundle(): RecoveryBundle | null {
  return readBundle();
}

export function clearRecoveryBundle(): void {
  writeBundle(null);
}

/**
 * Refresh the durable bundle from a live session. Called automatically by
 * setAuthSession for every session that carries both a user and a recovery
 * token (login, register, guest, Discord handoff, refresh, profile updates),
 * so the cached profile tracks the real one.
 *
 * A session without a recovery token cannot form a bundle on its own — but
 * it may safely refresh the PROFILE of an existing bundle (same account id),
 * keeping the avatar/settings current for a future rebuild.
 */
export function rememberRecovery(tokens: AuthTokens | null): void {
  if (!tokens?.user?.id) return;
  const existing = readBundle();
  const token = tokens.recoveryToken || existing?.recoveryToken;
  if (!token) return;
  const sameAccount = existing?.accountId === tokens.user.id;
  // a different account's token must never be attached to this profile
  if (!tokens.recoveryToken && !sameAccount) return;
  writeBundle({
    accountId: tokens.user.id,
    username: tokens.user.username ?? existing?.username ?? "",
    recoveryToken: token,
    user: { ...(sameAccount ? existing?.user : undefined), ...tokens.user },
    savedAt: new Date().toISOString(),
  });
}

/**
 * Ask the server to re-sign this browser in from the durable bundle.
 *
 * - 200 -> fresh tokens (+ user) for the caller to install via setAuthSession
 * - 401 RECOVERY_INVALID -> the server definitively rejects this bundle
 *   (secret rotated beyond both fallbacks, account deleted) — the bundle is
 *   dropped so we stop retrying forever
 * - network/5xx -> null, bundle kept; the next visit retries
 */
export async function recoverAccount(): Promise<AuthTokens | null> {
  const bundle = getRecoveryBundle();
  if (!bundle) return null;
  try {
    const response = await fetch("/api/auth/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: bundle.accountId,
        recoveryToken: bundle.recoveryToken,
        user: bundle.user,
      }),
    });
    if (response.ok) {
      const next = (await response.json().catch(() => null)) as
        | (AuthTokens & { recovered?: boolean })
        | null;
      if (next?.accessToken && next.user) return next;
      return null;
    }
    if (response.status === 401 || response.status === 403) {
      console.warn("[Auth] recovery bundle rejected — dropping it");
      clearRecoveryBundle();
    }
    return null;
  } catch {
    // server unreachable — keep the bundle, retry on a future visit
    return null;
  }
}
