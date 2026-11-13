import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getValidLinerAccessToken,
  forgetLinerSession,
} from "./linerSession";
import { setAuthSession } from "./auth-session";

/**
 * The v1.26 bridge: with the upstream-parity switch, an upstream Liner login
 * stores its tokens in the MAIN auth session — there is no separate liner
 * session any more. getValidLinerAccessToken must therefore hand out the
 * main session's token when it is an upstream token, but NEVER a website
 * token (at_/rt_ — a different trust domain, worthless to api.tryliner.fun).
 */
describe("linerSession — main-session bridge (v1.26)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    forgetLinerSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setAuthSession(null);
    window.localStorage.clear();
    forgetLinerSession();
  });

  it("bridges to the main session when it holds an upstream token", async () => {
    setAuthSession({
      accessToken: "upstream-access-token",
      refreshToken: "upstream-refresh-token",
      accessTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const token = await getValidLinerAccessToken();
    expect(token).toBe("upstream-access-token");
  });

  it("never bridges to a website session (at_/rt_ are a different domain)", async () => {
    setAuthSession({
      accessToken: "at_website_token",
      refreshToken: "rt_website_token",
      accessTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(await getValidLinerAccessToken()).toBeNull();
  });

  it("still prefers a dedicated liner session over the main session", async () => {
    setAuthSession({
      accessToken: "upstream-access-token",
      refreshToken: "upstream-refresh-token",
      accessTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    window.localStorage.setItem(
      "liner_liner_session_v1",
      JSON.stringify({
        email: "me@example.com",
        accessToken: "dedicated-liner-token",
        refreshToken: "dedicated-refresh",
        savedAt: Date.now(),
      }),
    );
    const token = await getValidLinerAccessToken();
    expect(token).toBe("dedicated-liner-token");
  });

  it("returns null when neither session exists", async () => {
    expect(await getValidLinerAccessToken()).toBeNull();
  });
});
