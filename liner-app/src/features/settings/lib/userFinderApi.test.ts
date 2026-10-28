// Task 36: User Finder API client — admin gate error mapping + 401 retry.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { findUser, UserFinderError } from "./userFinderApi";

const mockRefresh = vi.fn();

vi.mock("@/shared/api/auth-session", () => ({
  refreshAuthSession: () => mockRefresh(),
}));

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("userFinderApi", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefresh.mockResolvedValue({ accessToken: "fresh-token" });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns the parsed lookup result with the bearer token attached", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).authorization).toBe(
        "Bearer tok-1",
      );
      expect(String(_url)).toContain("/api/userfinder?username=liner");
      return okResponse({
        found: true,
        username: "liner",
        profile: { email: "liner@test.dev", lastSeenAt: "2026-01-01T00:00:00Z" },
        recentSongs: [],
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await findUser("liner", "tok-1");
    expect(result.found).toBe(true);
    expect(result.profile?.email).toBe("liner@test.dev");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps 403 to a forbidden UserFinderError", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    await expect(findUser("liner", "tok")).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
  });

  it("maps 400 to invalid_username", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 400 })) as unknown as typeof fetch;
    await expect(findUser("bad name!", "tok")).rejects.toBeInstanceOf(
      UserFinderError,
    );
  });

  it("on 401 refreshes the session once and retries with the fresh token", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).authorization;
      if (auth === "Bearer stale") {
        return new Response("{}", { status: 401 });
      }
      return okResponse({ found: false, username: "liner" });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await findUser("liner", "stale");
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(result.found).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries even when refresh produces nothing (cookie can vouch server-side)", async () => {
    mockRefresh.mockResolvedValue(null);
    const fetchMock = vi.fn(
      async () => new Response("{}", { status: 401 }),
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await expect(findUser("liner", "stale")).rejects.toMatchObject({
      code: "unauthorized",
    });
    // same model as moderation: the same-origin admin cookie may vouch for
    // the retry even without a fresh Liner token
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
