// Task 27 E2E (banned wall): seed a fake session for a banned account.
// The ban itself lives in the website's real SQLite db (seeded by
// scripts/task27_seed_bans.ts) so /api/moderation/check is NOT mocked —
// this exercises the real client gate end-to-end.
(() => {
  const SESSION = {
    accessToken: "e2e-fake-token",
    refreshToken: "e2e-fake-refresh",
    accessTokenExpiresAt: Date.now() + 3600e3,
    expiresAt: Date.now() + 3600e3,
    user: {
      id: "e2e-banned",
      email: "e2ebanned@test.local",
      username: "e2ebanned",
      displayName: "E2E Banned",
    },
  };
  try {
    localStorage.setItem("liner_auth_session", JSON.stringify(SESSION));
  } catch {}

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
    return origFetch(input, init);
  };
})();
