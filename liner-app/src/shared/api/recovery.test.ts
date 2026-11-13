import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearRecoveryBundle,
  getRecoveryBundle,
  recoverAccount,
  rememberRecovery,
  type RecoveryBundle,
} from "./recovery";
import type { AuthTokens } from "../contracts";

function tokensFor(
  id: string,
  overrides: Partial<AuthTokens> = {},
): AuthTokens {
  return {
    accessToken: `at_${id}`,
    refreshToken: `rt_${id}`,
    accessTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    recoveryToken: `wrc1_${id.padEnd(64 - id.length, "0")}`,
    user: {
      id,
      username: `user_${id}`,
      displayName: `User ${id}`,
      email: `${id}@example.com`,
      isGuest: false,
      isPublic: false,
      showActivity: true,
      showHistory: true,
      showLikedTracks: true,
      participateLeaderboards: false,
    },
    ...overrides,
  } as AuthTokens;
}

describe("recovery bundle persistence", () => {
  beforeEach(() => {
    clearRecoveryBundle();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearRecoveryBundle();
  });

  it("forms a bundle from a session that carries a recovery token", () => {
    rememberRecovery(tokensFor("a1"));

    const bundle = getRecoveryBundle();
    expect(bundle).not.toBeNull();
    expect(bundle?.accountId).toBe("a1");
    expect(bundle?.username).toBe("user_a1");
    expect(bundle?.user.email).toBe("a1@example.com");
    expect(bundle?.recoveryToken).toBeTruthy();
  });

  it("refreshes the cached profile on later sessions for the same account", () => {
    rememberRecovery(tokensFor("a1"));
    rememberRecovery(
      tokensFor("a1", {
        user: {
          id: "a1",
          username: "user_a1",
          displayName: "Renamed",
        } as AuthTokens["user"],
      }),
    );

    expect(getRecoveryBundle()?.user.displayName).toBe("Renamed");
  });

  it("keeps the existing token when a refreshed session lacks one (same account)", () => {
    rememberRecovery(tokensFor("a1"));
    const refreshed = tokensFor("a1");
    delete (refreshed as { recoveryToken?: string }).recoveryToken;
    rememberRecovery(refreshed);

    const bundle = getRecoveryBundle();
    expect(bundle?.recoveryToken?.startsWith("wrc1_a1")).toBe(true);
    expect(bundle?.accountId).toBe("a1");
  });

  it("never attaches a foreign token to a different account's profile", () => {
    rememberRecovery(tokensFor("a1"));
    const other = tokensFor("b2");
    delete (other as { recoveryToken?: string }).recoveryToken;
    rememberRecovery(other);

    // no token in the session AND the bundle belongs to a different account
    // -> the profile swap is refused
    expect(getRecoveryBundle()?.accountId).toBe("a1");
  });

  it("a session WITH its own token legitimately switches the bundle to a new account", () => {
    rememberRecovery(tokensFor("a1"));
    rememberRecovery(tokensFor("b2"));

    expect(getRecoveryBundle()?.accountId).toBe("b2");
  });

  it("clearRecoveryBundle removes the bundle (intentional sign-out)", () => {
    rememberRecovery(tokensFor("a1"));
    clearRecoveryBundle();
    expect(getRecoveryBundle()).toBeNull();
  });
});

describe("recoverAccount", () => {
  beforeEach(() => {
    clearRecoveryBundle();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearRecoveryBundle();
  });

  it("returns the fresh tokens when the server accepts the bundle", async () => {
    rememberRecovery(tokensFor("a1"));
    const recoveredTokens = {
      accessToken: "at_new",
      refreshToken: "rt_new",
      accessTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      user: { id: "a1", username: "user_a1" },
      recovered: true,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(recoveredTokens), { status: 200 }),
    );

    const result = await recoverAccount();

    expect(result?.accessToken).toBe("at_new");
    expect(result?.user.id).toBe("a1");
    // bundle survives a successful recovery (session drops stay recoverable)
    expect(getRecoveryBundle()?.accountId).toBe("a1");
  });

  it("posts the accountId, recoveryToken and cached profile", async () => {
    rememberRecovery(tokensFor("a1"));
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 500 }));

    await recoverAccount();

    const [url, init] = spy.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    expect(url).toBe("/api/auth/recover");
    const body = JSON.parse(init.body) as RecoveryBundle & { user: unknown };
    expect(body.accountId).toBe("a1");
    expect(body.recoveryToken?.startsWith("wrc1_a1")).toBe(true);
    expect(body.user).toBeTruthy();
  });

  it("a definitive 401 rejection drops the bundle so it stops retrying", async () => {
    rememberRecovery(tokensFor("a1"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "RECOVERY_INVALID" }), {
        status: 401,
      }),
    );

    const result = await recoverAccount();

    expect(result).toBeNull();
    expect(getRecoveryBundle()).toBeNull();
  });

  it("a network failure keeps the bundle for the next visit", async () => {
    rememberRecovery(tokensFor("a1"));
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));

    const result = await recoverAccount();

    expect(result).toBeNull();
    expect(getRecoveryBundle()?.accountId).toBe("a1");
  });

  it("a 5xx keeps the bundle (server down, not a rejection)", async () => {
    rememberRecovery(tokensFor("a1"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("bad gateway", { status: 502 }),
    );

    const result = await recoverAccount();

    expect(result).toBeNull();
    expect(getRecoveryBundle()?.accountId).toBe("a1");
  });
});
