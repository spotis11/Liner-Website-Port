import { create } from "zustand";
import { api, ApiError, HumanCheckCancelledError } from "@/shared/api";
import {
  clearAuthSession,
  clearRecoveryBundle,
  getAuthSession,
  getRecoveryBundle,
  recoverAccount,
  setAuthSession,
  refreshAuthSession,
  type AuthUser,
  type PublicUser,
  type UpdateProfileInput,
} from "@/shared/api";
import { playerEngine } from "@/features/player";
import { queryCache } from "@/shared/cache/queryCache";
import { checkBan, ModerationError } from "@/features/moderation/lib/moderationApi";
import { useBanStore } from "@/features/moderation/store/banStore";
import { useWelcomeStore } from "@/features/welcome/store/welcomeStore";
import { clearScreenCache } from "@/shared/cache/screenCache";
import {
  readLikedCache,
  reloadLikedTracks,
} from "@/features/library/hooks/useLikedTracks";

export type AuthStatus = "initializing" | "authenticated" | "anonymous";
export interface DiscordLoginPayload {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  /** durable recovery credential from the callback handoff (rc= param) */
  recoveryToken?: string;
  user: AuthUser;
}
export type AuthState = {
  status: AuthStatus;
  user: AuthUser | null;
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  guestLogin: () => Promise<void>;
  register: (
    email: string,
    password: string,
    username: string,
    displayName: string,
  ) => Promise<void>;
  /** OAuth handoff: install a session already minted by /api/auth/discord/callback */
  completeDiscordLogin: (payload: DiscordLoginPayload) => Promise<void>;
  updateProfile: (patch: UpdateProfileInput) => Promise<PublicUser>;
  /** add a password to a Discord-linked account, or change an existing one */
  setPassword: (input: { password: string; currentPassword?: string }) => Promise<void>;
  logout: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  status: "initializing",
  user: null,
  initialize: async () => {
    const stored = getAuthSession();
    if (!stored) {
      // No live session — but a durable recovery bundle may exist (e.g. the
      // session was dropped on an earlier visit because the server lost it).
      // Try silent recovery before showing the sign-in/onboarding wall.
      if (await tryRecoverAccount()) return;
      set({ status: "anonymous", user: null });
      return;
    }
    // Zombie session guard: upstream access tokens live ~15 minutes and the
    // ONLY way to renew them is the refresh token. A stored session without
    // a usable refresh token can never renew — it either already fails every
    // authed call or will within minutes, and the owner just sees confusing
    // "session expired" / network errors (Task 28). Drop it up front so the
    // next visit is a clean sign-in instead of a half-broken state.
    if (!stored.refreshToken || !stored.refreshToken.trim()) {
      // A session without a refresh token can never renew — but the
      // recovery bundle may still bring the account back silently.
      setAuthSession(null);
      if (await tryRecoverAccount()) return;
      set({ status: "anonymous", user: null });
      return;
    }
    // Optimistically authenticate if stored user is present
    if (stored.user) {
      set({ status: "authenticated", user: stored.user });
    }
    try {
      const getMePromise = api.getMe();
      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("Auth initialize timeout")), 6000),
      );
      const user = await Promise.race([getMePromise, timeoutPromise]);
      const current = getAuthSession();
      if (current) setAuthSession({ ...current, user: user ?? current.user });
      set({
        status: "authenticated",
        user: user ?? current?.user ?? stored.user,
      });
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.status === 401 || err.status === 403)
      ) {
        // Attempt refresh before clearing session in case access token expired between sessions
        const current = getAuthSession();
        if (current?.refreshToken) {
          try {
            const refreshed = await refreshAuthSession();
            if (refreshed) {
              const retryUser = await api.getMe().catch(() => null);
              const active = getAuthSession();
              if (active)
                setAuthSession({ ...active, user: retryUser ?? active.user });
              set({
                status: "authenticated",
                user:
                  retryUser ?? refreshed.user ?? current.user ?? stored.user,
              });
              return;
            }
          } catch {
            // refresh failed
          }
        }
        // refreshAuthSession already drops the session when the server rejects the refresh token (401/403).
        // still here = the refresh failed for a transient reason (network, 5xx), so keep the user signed in.
        // shortcut: a server answering 400/422 for a dead refresh token keeps a broken session, use logout then
        const remaining = getAuthSession();
        if (remaining?.refreshToken) {
          set({ status: "authenticated", user: remaining.user ?? stored.user });
          return;
        }
        // The server definitively lost this session (rotation table gone —
        // historically a wiped production db). Last line of defense before
        // dropping the user on the onboarding: the client-held recovery
        // bundle re-signs them in (or rebuilds the account) silently.
        if (await tryRecoverAccount()) return;
        setAuthSession(null);
        set({ status: "anonymous", user: null });
      } else {
        // If it's a network error, timeout, or transient 5xx, preserve authenticated state if we have a stored session
        if (stored.user || stored.accessToken) {
          set({ status: "authenticated", user: stored.user });
        } else {
          setAuthSession(null);
          set({ status: "anonymous", user: null });
        }
      }
    }
  },
  login: async (email, password) => {
    const result = await api.login(email, password);
    // website-port ban gate: banned accounts are refused the session
    await enforceWebsiteBan(result.user).catch(() => {});
    set({ status: "authenticated", user: result.user });
    // api.login IS the upstream Liner sign-in since the upstream-parity
    // switch (PoW, relayed same-origin) — its tokens are the session, so the
    // old separate browser-direct linerLoginUpstream link is gone. Word-level
    // lyrics read the main session via the linerSession bridge.
    // welcome flow: returning users get the single "Welcome back" greeting
    useWelcomeStore.getState().notifyLogin(result.user);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("library:changed"));
    }
  },
  register: async (email, password, username, displayName) => {
    const result = await api.register(email, password, username, displayName);
    // website-port ban gate: banned accounts are refused the session
    await enforceWebsiteBan(result.user).catch(() => {});
    set({ status: "authenticated", user: result.user });
    // welcome flow: brand-new accounts get the 3-step onboarding wizard
    useWelcomeStore.getState().notifyRegister(result.user);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("library:changed"));
    }
  },
  guestLogin: async () => {
    // guest mode: a real account row in the website's own database — no
    // email/password, permanent across restarts, private by default
    const result = await api.guestLogin();
    await enforceWebsiteBan(result.user).catch(() => {});
    set({ status: "authenticated", user: result.user });
    useWelcomeStore.getState().notifyLogin(result.user);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("library:changed"));
    }
  },
  completeDiscordLogin: async (payload) => {
    // the session was minted server-side by /api/auth/discord/callback and
    // handed over in the URL fragment — install it, then run the same gates
    // as every other sign-in (ban wall, welcome greeting, library refresh)
    setAuthSession(payload);
    await enforceWebsiteBan(payload.user).catch(() => {});
    set({ status: "authenticated", user: payload.user });
    useWelcomeStore.getState().notifyLogin(payload.user);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("library:changed"));
    }
  },
  updateProfile: async (patch) => {
    const updated = await api.updateProfile(patch);
    const current = getAuthSession();
    if (current) {
      setAuthSession({ ...current, user: { ...current.user, ...updated } });
    }
    set((prev) => ({
      user: prev.user ? { ...prev.user, ...updated } : updated,
    }));
    return updated;
  },
  setPassword: async ({ password, currentPassword }) => {
    await api.setPassword({ password, currentPassword });
    // flip the local hint immediately so the form switches to "change password"
    set((prev) =>
      prev.user ? { user: { ...prev.user, hasPassword: true } } : prev,
    );
    const current = getAuthSession();
    if (current?.user) {
      setAuthSession({ ...current, user: { ...current.user, hasPassword: true } });
    }
  },
  logout: async () => {
    // intentional sign-out also retires the durable recovery bundle —
    // a signed-out browser must never auto-reconnect the account
    clearRecoveryBundle();
    await clearPlayback();
    try {
      window.linerElectron?.closeOverlay?.();
      window.linerElectron?.sendOverlayAction?.({ type: "closeOverlay" });
    } catch {}
    if (
      typeof window !== "undefined" &&
      window.location.hash.includes("/player")
    ) {
      window.location.hash = "#/";
    }
    await clearAuthSession();
    queryCache.clear();
    clearScreenCache();
    set({ status: "anonymous", user: null });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("library:changed"));
    }
  },
}));

/**
 * Website-port ban gate for the login/register flow: when the website's
 * backend reports the account as banned, the just-created session is dropped
 * immediately, the banned wall goes up (with the account's profile picture,
 * captured while the session is still alive) and a ModerationError is thrown
 * so the login form surfaces the ban instead of the app.
 */
async function enforceWebsiteBan(user: { username?: string | null; avatarUrl?: string | null } | null): Promise<void> {
  const username = user?.username ?? null;
  if (!username) return;
  const session = getAuthSession();
  const result = await checkBan(username, session?.accessToken).catch(() => null);
  if (!result?.banned) return;
  // the ban wall is a definitive exit — retire the recovery bundle too,
  // otherwise the client would silently reconnect on the next visit
  clearRecoveryBundle();
  await clearAuthSession();
  useBanStore.getState().setBan({
    username: result.username ?? username,
    type: result.type === "ip" ? "ip" : "normal",
    reason: result.reason ?? null,
    createdAt: new Date().toISOString(),
    expiresAt: result.expiresAt ?? null,
    avatarUrl: user?.avatarUrl ?? null,
  });
  throw new ModerationError("banned", 403);
}

const PLAYBACK_CLEAR_TIMEOUT_MS = 3_000;

async function clearPlayback(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, PLAYBACK_CLEAR_TIMEOUT_MS);
  });
  try {
    await Promise.race([playerEngine.stopAndClear().catch(() => {}), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

useAuthStore.subscribe((state, previous) => {
  if (state.status === "anonymous" && previous.status !== "anonymous") {
    void clearPlayback();
  }
});

/** Re-push the client-cached liked library after a recovery rebuild. */
const RECOVERY_LIKE_CAP = 500;
const RECOVERY_LIKE_CONCURRENCY = 4;

export async function repushLikedLibrary(): Promise<void> {
  const cached = readLikedCache().slice(0, RECOVERY_LIKE_CAP);
  if (cached.length === 0) return;
  let cursor = 0;
  const worker = async () => {
    while (cursor < cached.length) {
      const track = cached[cursor++];
      await api.likeTrackSnapshot(
        track as unknown as { id: string; title: string } & Record<string, unknown>,
      ).catch(() => undefined);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(RECOVERY_LIKE_CONCURRENCY, cached.length) },
      () => worker(),
    ),
  );
}

/**
 * Silent account recovery — the client half of the permanent logout fix.
 * Runs only when a durable recovery bundle exists and the session is
 * definitively dead (server lost its session/account rows). On success the
 * user is signed straight back in — never the "create an account" wall.
 */
async function tryRecoverAccount(): Promise<boolean> {
  const bundle = getRecoveryBundle();
  if (!bundle) return false;
  const tokens = await recoverAccount();
  if (!tokens?.user) return false;
  try {
    // same gates as every other sign-in: banned accounts hit the ban wall
    await enforceWebsiteBan(tokens.user);
  } catch {
    // enforceWebsiteBan cleared the session and raised the wall
    return false;
  }
  setAuthSession(tokens);
  useAuthStore.setState({ status: "authenticated", user: tokens.user });
  useWelcomeStore.getState().notifyLogin(tokens.user);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("library:changed"));
  }
  // the account row may have been rebuilt from the cached profile — restore
  // the liked library from the client cache in the background
  void repushLikedLibrary()
    .catch(() => undefined)
    .then(() => reloadLikedTracks().catch(() => undefined));
  return true;
}

export function getAuthErrorCode(error: unknown): string {
  if (error instanceof HumanCheckCancelledError) return "human_check_cancelled";
  if (!(error instanceof ApiError)) return "server_unavailable";
  if (error.status === 0) return "server_unavailable";
  // 5xx and cloudflare 52x: the server is down, not the user's input or connection
  if (error.status >= 500) return "server_error";
  if (error.code === "INVALID_CREDENTIALS") return "invalid_credentials";
  if (error.code === "DISCORD_ONLY") return "discord_only";
  if (error.code === "EMAIL_ALREADY_USED") return "email_already_used";
  if (error.code === "EMAIL_TAKEN") return "email_already_used";
  if (error.code === "TAKEN") return "email_already_used";
  if (error.code === "USERNAME_TAKEN") return "username_taken";
  if (error.code === "INVALID_USERNAME") return "invalid_username";
  if (error.code === "WEAK_PASSWORD") return "weak_password";
  if (error.code === "WRONG_PASSWORD") return "wrong_password";
  if (error.code === "INVALID_INPUT") return "invalid_input";
  if (error.code?.startsWith("TURNSTILE_")) return "human_check_failed";
  return "unknown_error";
}

export function authErrorMessage(error: unknown): string {
  if (error instanceof ModerationError && error.code === "banned") {
    return "This account has been banned from this website.";
  }
  if (!(error instanceof ApiError)) return "Unable to reach the server.";
  if (error.code === "INVALID_CREDENTIALS")
    return "Email or password is incorrect.";
  if (error.code === "DISCORD_ONLY")
    return "That account was created with Discord — use the Continue with Discord button to sign in.";
  if (error.code === "EMAIL_ALREADY_USED" || error.code === "EMAIL_TAKEN")
    return "This email is already in use.";
  if (error.code === "USERNAME_TAKEN")
    return "This username is already taken. Please choose another.";
  if (error.code === "INVALID_USERNAME")
    return "Username must be 3-30 lowercase characters (a-z, 0-9, _).";
  if (error.code === "WEAK_PASSWORD")
    return "Password must be at least 8 characters.";
  if (error.code === "WRONG_PASSWORD")
    return "Current password is incorrect.";
  // unknown api errors stay generic, never surface raw bodies
  return "Something went wrong. Please try again.";
}
