import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// the player feature pulls lottie/canvas ui that jsdom cannot load; initialize() never touches it
const player = vi.hoisted(() => ({ stopAndClear: vi.fn(async () => {}) }));
vi.mock("@/features/player", () => ({ playerEngine: player }));

import { useAuthStore } from "./authStore";
import {
  api,
  ApiError,
  getAuthSession,
  getRecoveryBundle,
  setAuthSession,
  type AuthTokens,
} from "@/shared/api";
import { useBanStore } from "@/features/moderation/store/banStore";

const stored = {
  accessToken: "expired-access",
  refreshToken: "refresh-1",
  user: { id: "u1", username: "leo" },
} as unknown as AuthTokens;

describe("authStore.initialize — expired access token at launch", () => {
  beforeEach(() => {
    setAuthSession(stored);
    useAuthStore.setState({ status: "initializing", user: null });
    vi.spyOn(api, "getMe").mockRejectedValue(new ApiError(401, "Unauthorized"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setAuthSession(null);
  });

  it("keeps the session when the refresh fails for a transient reason (server down)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("error code: 525", { status: 525 }),
    );

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(getAuthSession()?.refreshToken).toBe("refresh-1");
  });

  it("signs out when the server rejects the refresh token", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ code: "INVALID_REFRESH_TOKEN" }), {
          status: 401,
        }),
    );

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().status).toBe("anonymous");
    expect(getAuthSession()).toBeNull();
  });

  it("stays signed in when a refresh 401 carries no token verdict", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("{}", { status: 401 }),
    );

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(getAuthSession()?.refreshToken).toBeTruthy();
  });
});

describe("authStore.initialize — zombie sessions (Task 28 session-expired fix)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setAuthSession(null);
  });

  it("drops a session that has no refresh token and goes anonymous (clean sign-in)", async () => {
    const zombie = {
      accessToken: "long-dead-access",
      refreshToken: "",
      accessTokenExpiresAt: new Date(Date.now() - 3_600_000).toISOString(),
      user: { id: "u1", username: "jayzeyluna" },
    } as unknown as AuthTokens;
    setAuthSession(zombie);
    useAuthStore.setState({ status: "initializing", user: null });

    await useAuthStore.getState().initialize();

    expect(getAuthSession()).toBeNull();
    expect(useAuthStore.getState().status).toBe("anonymous");
    expect(useAuthStore.getState().user).toBeNull();
    // no upstream call was even attempted — the session can never renew
  });

  it("keeps a healthy session that still has its refresh token", async () => {
    setAuthSession(stored);
    useAuthStore.setState({ status: "initializing", user: null });
    vi.spyOn(api, "getMe").mockResolvedValue({ id: "u1", username: "leo" } as never);

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(getAuthSession()?.refreshToken).toBe("refresh-1");
  });
});

describe("signing out clears the player", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    player.stopAndClear.mockReset();
    player.stopAndClear.mockImplementation(async () => {});
    setAuthSession(null);
  });

  it("logout stops playback while the old account's token still exists", async () => {
    setAuthSession(stored);
    useAuthStore.setState({ status: "authenticated", user: stored.user });
    let sessionDuringStop: unknown = "not called";
    player.stopAndClear.mockImplementation(async () => {
      if (sessionDuringStop === "not called")
        sessionDuringStop = getAuthSession();
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    await useAuthStore.getState().logout();

    expect(sessionDuringStop).toMatchObject({ refreshToken: "refresh-1" });
    expect(getAuthSession()).toBeNull();
    expect(useAuthStore.getState().status).toBe("anonymous");
  });

  it("clears the player whenever the app ends up signed out", async () => {
    useAuthStore.setState({ status: "initializing", user: null });
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().status).toBe("anonymous");
    expect(player.stopAndClear).toHaveBeenCalled();
  });

  it("does not hang logout when the player never finishes", async () => {
    vi.useFakeTimers();
    try {
      setAuthSession(stored);
      useAuthStore.setState({ status: "authenticated", user: stored.user });
      player.stopAndClear.mockImplementation(() => new Promise(() => {}));
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 204 }),
      );
      const loggingOut = useAuthStore.getState().logout();
      await vi.advanceTimersByTimeAsync(3_000);
      await loggingOut;
      expect(useAuthStore.getState().status).toBe("anonymous");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// account recovery — the permanent fix for the "logged out + create an
// account" cycle (server lost its session/account rows)
// ---------------------------------------------------------------------------

function seedRecoveryBundle(username = "jayzeyluna"): void {
  setAuthSession({
    accessToken: "at_seed",
    refreshToken: "rt_seed",
    accessTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    recoveryToken: "wrc1_seed_token",
    user: {
      id: "acc_owner",
      username,
      displayName: "Jayzey Luna",
      email: "owner@example.com",
    },
  } as AuthTokens);
}

describe("authStore.initialize — silent account recovery after a server wipe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setAuthSession(null);
    window.localStorage.removeItem("liner_account_recovery_v1");
    useBanStore.setState({ ban: null });
    window.localStorage.removeItem("liner_web_ban_v1");
  });

  it("re-signs the user in from the bundle when the server lost every session", async () => {
    seedRecoveryBundle();
    setAuthSession({
      accessToken: "dead-access",
      refreshToken: "dead-refresh",
      accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      user: { id: "acc_owner", username: "jayzeyluna" },
    } as AuthTokens);
    useAuthStore.setState({ status: "initializing", user: null });
    vi.spyOn(api, "getMe").mockRejectedValue(new ApiError(401, "Unauthorized"));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("/api/auth/refresh")) {
        return new Response(JSON.stringify({ code: "INVALID_REFRESH_TOKEN" }), {
          status: 401,
        });
      }
      if (url.includes("/api/auth/recover")) {
        return new Response(
          JSON.stringify({
            accessToken: "at_recovered",
            refreshToken: "rt_recovered",
            accessTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            user: { id: "acc_owner", username: "jayzeyluna", displayName: "Jayzey Luna" },
            recovered: true,
          }),
          { status: 200 },
        );
      }
      if (url.includes("/api/moderation/check")) {
        return new Response(JSON.stringify({ banned: false }), { status: 200 });
      }
      if (url.includes("/api/library/tracks")) {
        return new Response(JSON.stringify({ items: [], nextCursor: null }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 404 });
    });

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(useAuthStore.getState().user?.username).toBe("jayzeyluna");
    expect(getAuthSession()?.accessToken).toBe("at_recovered");
    // the bundle refreshed itself from the recovered session
    expect(getRecoveryBundle()?.recoveryToken).toBeTruthy();
  });

  it("recovers with no stored session at all (logged-out state left by an earlier wipe)", async () => {
    seedRecoveryBundle();
    setAuthSession(null);
    useAuthStore.setState({ status: "initializing", user: null });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("/api/auth/recover")) {
        return new Response(
          JSON.stringify({
            accessToken: "at_recovered",
            refreshToken: "rt_recovered",
            accessTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            user: { id: "acc_owner", username: "jayzeyluna" },
            recovered: true,
          }),
          { status: 200 },
        );
      }
      if (url.includes("/api/moderation/check")) {
        return new Response(JSON.stringify({ banned: false }), { status: 200 });
      }
      if (url.includes("/api/library/tracks")) {
        return new Response(JSON.stringify({ items: [], nextCursor: null }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 404 });
    });

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(getAuthSession()?.refreshToken).toBe("rt_recovered");
  });

  it("falls back to anonymous when there is no bundle (no bundle, no magic)", async () => {
    useAuthStore.setState({ status: "initializing", user: null });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().status).toBe("anonymous");
    // the previous behavior is intact — and no recovery request was made
    expect(
      fetchSpy.mock.calls.some(([, init]) => {
        const body = (init as { body?: string } | undefined)?.body ?? "";
        return body.includes("recoveryToken");
      }),
    ).toBe(false);
  });

  it("a rejected bundle goes anonymous and stops retrying forever", async () => {
    seedRecoveryBundle();
    setAuthSession(null);
    useAuthStore.setState({ status: "initializing", user: null });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("/api/auth/recover")) {
        return new Response(JSON.stringify({ code: "RECOVERY_INVALID" }), {
          status: 401,
        });
      }
      return new Response("{}", { status: 404 });
    });

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().status).toBe("anonymous");
    expect(getRecoveryBundle()).toBeNull();
  });

  it("a banned account hits the ban wall and loses the bundle", async () => {
    seedRecoveryBundle("banned_user");
    setAuthSession(null);
    useAuthStore.setState({ status: "initializing", user: null });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("/api/auth/recover")) {
        return new Response(
          JSON.stringify({
            accessToken: "at_recovered",
            refreshToken: "rt_recovered",
            accessTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            user: { id: "acc_owner", username: "banned_user" },
            recovered: true,
          }),
          { status: 200 },
        );
      }
      if (url.includes("/api/moderation/check")) {
        return new Response(
          JSON.stringify({
            banned: true,
            username: "banned_user",
            type: "normal",
            reason: "spam",
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().status).toBe("anonymous");
    expect(getAuthSession()).toBeNull();
    expect(getRecoveryBundle()).toBeNull();
    expect(useBanStore.getState().ban?.username).toBe("banned_user");
  });

  it("logout retires the recovery bundle (a signed-out browser never auto-reconnects)", async () => {
    seedRecoveryBundle();
    setAuthSession({
      accessToken: "at_live",
      refreshToken: "rt_live",
      accessTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      user: { id: "acc_owner", username: "jayzeyluna" },
    } as AuthTokens);
    useAuthStore.setState({ status: "authenticated", user: null });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    expect(getRecoveryBundle()?.accountId).toBe("acc_owner");
    await useAuthStore.getState().logout();

    expect(getRecoveryBundle()).toBeNull();
    expect(useAuthStore.getState().status).toBe("anonymous");
  });
});
