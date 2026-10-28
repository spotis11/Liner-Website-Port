// Task 27 E2E (owner-only Moderation tab): seed a fake session for the site
// owner and answer the website-port admin endpoints with canned data — the
// real /api/moderation/bans verifies tokens against the upstream Liner API,
// which a fake token can never pass (by design), so the UI test mocks it.
(() => {
  const SESSION = {
    accessToken: "e2e-fake-token",
    refreshToken: "e2e-fake-refresh",
    accessTokenExpiresAt: Date.now() + 3600e3,
    expiresAt: Date.now() + 3600e3,
    user: {
      id: "e2e-owner",
      email: "owner@test.local",
      username: "jayzeyluna",
      displayName: "JayJoice",
    },
  };
  try {
    localStorage.setItem("liner_auth_session", JSON.stringify(SESSION));
  } catch {}

  const CANNED_BANS = {
    bans: [
      {
        username: "e2espammer",
        type: "ip",
        reason: "spam links in chat",
        createdAt: "2026-10-26T10:00:00.000Z",
        expiresAt: null,
        createdBy: "jayzeyluna",
        bannedIps: ["203.0.113.77", "198.51.100.11"],
      },
      {
        username: "e2etemporary",
        type: "normal",
        reason: null,
        createdAt: "2026-10-27T08:00:00.000Z",
        expiresAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
        createdBy: "jayzeyluna",
        bannedIps: [],
      },
    ],
  };

  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input && input.url ? input.url : String(input);
    if (url.includes("/v1/me") && !url.includes("/v1/me/")) {
      return new Response(JSON.stringify(SESSION.user), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/auth/refresh")) {
      return new Response(
        JSON.stringify({
          accessToken: "e2e-fake-token",
          refreshToken: "e2e-fake-refresh",
          accessTokenExpiresAt: Date.now() + 3600e3,
          expiresAt: Date.now() + 3600e3,
          user: SESSION.user,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/api/moderation/bans")) {
      const method = (init?.method ?? "GET").toUpperCase();
      (window.__modCalls = window.__modCalls || []).push({
        method,
        body: init?.body ? String(init.body) : null,
      });
      if (method === "GET") {
        return new Response(JSON.stringify(CANNED_BANS), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "DELETE") {
        return new Response(JSON.stringify({ ok: true, removedIps: 2 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}"));
        return new Response(
          JSON.stringify({
            ban: {
              username: body.username,
              type: body.type,
              reason: body.reason,
              createdAt: new Date().toISOString(),
              expiresAt:
                body.durationHours === null
                  ? null
                  : new Date(Date.now() + body.durationHours * 3600_000).toISOString(),
              createdBy: "jayzeyluna",
              bannedIps: body.type === "ip" ? ["203.0.113.77"] : [],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
    }
    return origFetch(input, init);
  };
})();
