import { create } from "zustand";
import { api, ApiError } from "@/shared/api";
import {
  clearAuthSession,
  getAuthSession,
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

export type AuthStatus = "initializing" | "authenticated" | "anonymous";
export type AuthState = {
  status: AuthStatus;
  user: AuthUser | null;
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    username: string,
    displayName: string,
  ) => Promise<void>;
  updateProfile: (patch: UpdateProfileInput) => Promise<PublicUser>;
  logout: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  status: "initializing",
  user: null,
  initialize: async () => {
    const stored = getAuthSession();
    if (!stored) {
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
      setAuthSession(null);
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
      set({ status: "authenticated", user: user ?? current?.user ?? stored.user });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        // Attempt refresh before clearing session in case access token expired between sessions
        const current = getAuthSession();
        if (current?.refreshToken) {
          try {
            const refreshed = await refreshAuthSession();
            if (refreshed) {
              const retryUser = await api.getMe().catch(() => null);
              const active = getAuthSession();
              if (active) setAuthSession({ ...active, user: retryUser ?? active.user });
              set({
                status: "authenticated",
                user: retryUser ?? refreshed.user ?? current.user ?? stored.user,
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
  logout: async () => {
    await clearPlayback();
    try {
      window.linerElectron?.closeOverlay?.();
      window.linerElectron?.sendOverlayAction?.({ type: "closeOverlay" });
    } catch {}
    if (typeof window !== "undefined" && window.location.hash.includes("/player")) {
      window.location.hash = "#/";
    }
    await clearAuthSession();
    queryCache.clear();
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

export function getAuthErrorCode(error: unknown): string {
  if (!(error instanceof ApiError)) return "server_unavailable";
  if (error.status === 0) return "server_unavailable";
  // 5xx and cloudflare 52x: the server is down, not the user's input or connection
  if (error.status >= 500) return "server_error";
  if (error.code === "INVALID_CREDENTIALS") return "invalid_credentials";
  if (error.code === "EMAIL_ALREADY_USED") return "email_already_used";
  if (error.code === "USERNAME_TAKEN") return "username_taken";
  if (error.code === "INVALID_USERNAME") return "invalid_username";
  if (error.code === "INVALID_INPUT") return "invalid_input";
  return "unknown_error";
}

export function authErrorMessage(error: unknown): string {
  if (error instanceof ModerationError && error.code === "banned") {
    return "This account has been banned from this website.";
  }
  if (!(error instanceof ApiError)) return "Unable to reach the server.";
  if (error.code === "INVALID_CREDENTIALS")
    return "Email or password is incorrect.";
  if (error.code === "EMAIL_ALREADY_USED")
    return "This email is already in use.";
  if (error.code === "USERNAME_TAKEN")
    return "This username is already taken. Please choose another.";
  if (error.code === "INVALID_USERNAME")
    return "Username must be 3-30 lowercase characters (a-z, 0-9, _).";
  // unknown api errors stay generic, never surface raw bodies
  return "Something went wrong. Please try again.";
}
