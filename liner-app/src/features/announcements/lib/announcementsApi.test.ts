import { describe, expect, it, afterEach, vi } from "vitest";
import {
  fetchCurrentAnnouncement,
  isWebsiteAdmin,
  sendAnnouncement,
  WEBSITE_ADMIN_USERNAME,
} from "./announcementsApi";

const liveAnnouncement = {
  id: "ann_1",
  message: "the website will be updating soon with bug fixes, etc.\nsee you soon liners!",
  senderUsername: "jayzeyluna",
  senderName: "JayJoice",
  senderAvatarUrl: "https://api.tryliner.fun/avatar.png",
  createdAt: new Date().toISOString(),
};

describe("announcementsApi — website-port announcement admin gate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes the site owner's Liner username", () => {
    expect(WEBSITE_ADMIN_USERNAME).toBe("jayzeyluna");
  });

  it("isWebsiteAdmin matches only the owner handle (case-insensitive)", () => {
    expect(isWebsiteAdmin("jayzeyluna")).toBe(true);
    expect(isWebsiteAdmin("  JayZeyLuna ")).toBe(true);
    expect(isWebsiteAdmin("someoneelse")).toBe(false);
    expect(isWebsiteAdmin("")).toBe(false);
    expect(isWebsiteAdmin(null)).toBe(false);
    expect(isWebsiteAdmin(undefined)).toBe(false);
  });

  it("fetchCurrentAnnouncement probes the public endpoint and returns the payload", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ announcement: liveAnnouncement }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCurrentAnnouncement();

    expect(result?.id).toBe("ann_1");
    expect(result?.senderName).toBe("JayJoice");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/announcements/current");
    expect((init?.method as string) ?? "GET").toBe("GET");
  });

  it("fetchCurrentAnnouncement returns null when nothing is live", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ announcement: null }), { status: 200 }),
      ),
    );
    expect(await fetchCurrentAnnouncement()).toBeNull();
  });

  it("fetchCurrentAnnouncement drops malformed payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ announcement: { id: 1, nope: true } }), { status: 200 }),
      ),
    );
    expect(await fetchCurrentAnnouncement()).toBeNull();
  });

  it("sendAnnouncement POSTs the message with the Liner access token", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ announcement: liveAnnouncement }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendAnnouncement("hello liners", "token-123");

    expect(result.id).toBe("ann_1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/announcements");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      message: "hello liners",
      accessToken: "token-123",
    });
  });

  it("sendAnnouncement maps 403 to the forbidden code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "not_admin" }), { status: 403 }),
      ),
    );
    await expect(sendAnnouncement("hi", "token")).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
  });

  it("sendAnnouncement maps 401 to unauthorized", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 }),
      ),
    );
    await expect(sendAnnouncement("hi", "token")).rejects.toMatchObject({
      code: "unauthorized",
      status: 401,
    });
  });

  it("sendAnnouncement maps 429 to rate_limited", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 }),
      ),
    );
    await expect(sendAnnouncement("hi", "token")).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
    });
  });

  it("sendAnnouncement forces one refresh and retries when the served token went stale", async () => {
    const { setAuthSession } = await import("@/shared/api/auth-session");
    setAuthSession({
      accessToken: "stale",
      refreshToken: "rt-1",
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      user: { id: "u1" },
    });
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
        new Response(JSON.stringify({ announcement: liveAnnouncement }), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendAnnouncement("hi", "stale");

    expect(result.id).toBe("ann_1");
    const urls = fetchMock.mock.calls.map((call) => call[0]);
    expect(urls[0]).toBe("/api/announcements");
    expect(String(urls[1])).toContain("/v1/auth/refresh");
    expect(urls[2]).toBe("/api/announcements");
    const retryBody = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(retryBody.accessToken).toBe("fresh");
  });
});
