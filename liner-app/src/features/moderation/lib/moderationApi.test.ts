import { describe, expect, it, afterEach, vi } from "vitest";
import { setAuthSession, getAuthSession } from "@/shared/api/auth-session";
import {
  addBan,
  BAN_DURATION_PRESETS,
  checkBan,
  formatBanRemaining,
  listBans,
  ModerationError,
  normalizeUsername,
  removeBan,
} from "./moderationApi";

const banRow = {
  username: "spammer",
  type: "ip",
  reason: "spam",
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: null as string | null,
  createdBy: "jayzeyluna",
  bannedIps: ["1.2.3.4"],
};

describe("moderationApi — website-port ban system", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizeUsername applies the Liner username rules", () => {
    expect(normalizeUsername("  John_Doe ")).toBe("john_doe");
    expect(normalizeUsername("ab")).toBeNull();
    expect(normalizeUsername("has space")).toBeNull();
    expect(normalizeUsername("UPPER".toLowerCase())).toBe("upper");
    expect(normalizeUsername("")).toBeNull();
    expect(normalizeUsername(null)).toBeNull();
  });

  it("checkBan posts to the public probe and returns the verdict", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify({ banned: true, username: "spammer", type: "ip", expiresAt: null }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkBan("spammer", "token-1");

    expect(result.banned).toBe(true);
    expect(result.type).toBe("ip");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/moderation/check");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      username: "spammer",
      accessToken: "token-1",
    });
  });

  it("checkBan treats malformed payloads as an error (fail-open upstream)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ weird: true }), { status: 200 })),
    );
    await expect(checkBan("spammer")).rejects.toBeInstanceOf(ModerationError);
  });

  it("listBans returns the sanitized ban list from the admin endpoint", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify({ bans: [banRow, { username: "broken" }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const bans = await listBans("token-1");

    expect(bans).toHaveLength(1);
    expect(bans[0].username).toBe("spammer");
    expect(bans[0].bannedIps).toEqual(["1.2.3.4"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/moderation/bans");
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>).authorization).toBe(
      "Bearer token-1",
    );
  });

  it("addBan serializes durationHours (null = forever) into the POST body", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify({ ban: banRow }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await addBan(
      { username: "spammer", type: "ip", durationHours: null, reason: "spam" },
      "token-1",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      username: "spammer",
      type: "ip",
      durationHours: null,
      reason: "spam",
    });

    await addBan(
      { username: "spammer", type: "normal", durationHours: 24, reason: null },
      "token-1",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).durationHours).toBe(24);
  });

  it("addBan maps server-side rejections onto typed errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "cannot_ban_admin" }), { status: 400 }),
      ),
    );
    const err = await addBan(
      { username: "jayzeyluna", type: "normal", durationHours: 1 },
      "token-1",
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModerationError);
    expect((err as ModerationError).code).toBe("cannot_ban_admin");
  });

  it("admin endpoints surface 401/403 as unauthorized/forbidden", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 403 })),
    );
    await expect(listBans("token-1")).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      removeBan("spammer", "token-1"),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("removeBan issues DELETE with the username", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await removeBan("spammer", "token-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/moderation/bans");
    expect(init?.method).toBe("DELETE");
    expect(JSON.parse(String(init?.body))).toEqual({ username: "spammer" });
  });

  it("formatBanRemaining renders forever, running and expired bans", () => {
    const now = Date.parse("2026-01-10T12:00:00.000Z");
    expect(formatBanRemaining(null, now)).toEqual({ text: "Forever", forever: true });
    expect(formatBanRemaining("not-a-date", now).forever).toBe(true);

    const inTwoDays = new Date(now + 2 * 24 * 3_600_000 + 3 * 3_600_000).toISOString();
    expect(formatBanRemaining(inTwoDays, now).text).toBe("2d 3h left");

    const inNinetyMinutes = new Date(now + 90 * 60_000).toISOString();
    expect(formatBanRemaining(inNinetyMinutes, now).text).toBe("1h 30m left");

    const past = new Date(now - 1_000).toISOString();
    expect(formatBanRemaining(past, now).text).toBe("Expired");
  });

  it("exposes the duration presets ending with the custom escape hatch", () => {
    expect(BAN_DURATION_PRESETS[0]).toEqual({ value: "forever", hours: null });
    expect(BAN_DURATION_PRESETS[BAN_DURATION_PRESETS.length - 1]).toEqual({
      value: "custom",
      hours: -1,
    });
    expect(BAN_DURATION_PRESETS.map((preset) => preset.value)).toContain("24");
  });

  describe("stale-token self-healing (session-expired fix)", () => {
    const seedSession = (accessToken: string, refreshToken: string) =>
      setAuthSession({
        accessToken,
        refreshToken,
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        user: { id: "u1" },
      });

    it("listBans forces one refresh and retries when the served token went stale", async () => {
      seedSession("stale", "rt-1");
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response("{}", { status: 401 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              accessToken: "fresh",
              refreshToken: "rt-2",
              accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
              user: { id: "u1" },
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ bans: [banRow] }), { status: 200 }),
        );
      vi.stubGlobal("fetch", fetchMock);

      const bans = await listBans("stale");

      expect(bans).toHaveLength(1);
      const urls = fetchMock.mock.calls.map((call) => call[0]);
      expect(urls[0]).toBe("/api/moderation/bans");
      expect(String(urls[1])).toContain("/v1/auth/refresh");
      expect(urls[2]).toBe("/api/moderation/bans");
      const retryHeaders = fetchMock.mock.calls[2][1]?.headers as Record<string, string>;
      expect(retryHeaders.authorization).toBe("Bearer fresh");
    });

    it("surfaces unauthorized when the forced refresh cannot produce a fresh token", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      seedSession("stale", "rt-dead");
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response("{}", { status: 401 }))
        .mockResolvedValue(
          new Response(JSON.stringify({ code: "INVALID_REFRESH_TOKEN" }), { status: 401 }),
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(listBans("stale")).rejects.toMatchObject({
        code: "unauthorized",
        status: 401,
      });
      // a dead refresh token dropped the session (accurate state)
      expect(getAuthSession()).toBeNull();
      warn.mockRestore();
    });

    it("addBan rides the same refresh-and-retry path", async () => {
      seedSession("stale", "rt-1");
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response("{}", { status: 401 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              accessToken: "fresh",
              refreshToken: "rt-2",
              accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
              user: { id: "u1" },
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ban: banRow }), { status: 200 }),
        );
      vi.stubGlobal("fetch", fetchMock);

      const ban = await addBan(
        { username: "spammer", type: "ip", durationHours: null, reason: "spam" },
        "stale",
      );
      expect(ban.username).toBe("spammer");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("retries once with the same token when the refresh yields nothing (website admin cookie path)", async () => {
      // the Liner session is unusable (refresh dies upstream) but the website
      // admin cookie vouches for the browser on the retry — the request must
      // still succeed instead of showing "session expired"
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      seedSession("stale", "rt-dead");
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response("{}", { status: 401 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ code: "INVALID_REFRESH_TOKEN" }), { status: 401 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ bans: [banRow] }), { status: 200 }),
        );
      vi.stubGlobal("fetch", fetchMock);

      const bans = await listBans("stale");

      expect(bans).toHaveLength(1);
      const urls = fetchMock.mock.calls.map((call) => call[0]);
      // attempt -> refresh (dead) -> retry (cookie-authenticated success)
      expect(urls[0]).toBe("/api/moderation/bans");
      expect(String(urls[1])).toContain("/v1/auth/refresh");
      expect(urls[2]).toBe("/api/moderation/bans");
      const retryHeaders = fetchMock.mock.calls[2][1]?.headers as Record<string, string>;
      expect(retryHeaders.authorization).toBe("Bearer stale");
      warn.mockRestore();
    });

    it("sends the request without an Authorization header when no local token exists (cookie-only)", async () => {
      setAuthSession(null);
      const fetchMock = vi.fn(
        async (_url: string, _init?: RequestInit) =>
          new Response(JSON.stringify({ bans: [] }), { status: 200 }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const bans = await listBans(null);

      expect(bans).toEqual([]);
      const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers.authorization).toBeUndefined();
    });
  });
});
