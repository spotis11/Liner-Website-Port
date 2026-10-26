// E2E init script: seed a fake Liner session and answer /v1/me + /auth/refresh
// locally so the app boots authenticated without a real account.
(() => {
  const SESSION = {
    accessToken: "e2e-fake-token",
    refreshToken: "e2e-fake-refresh",
    accessTokenExpiresAt: Date.now() + 3600e3,
    expiresAt: Date.now() + 3600e3,
    user: {
      id: "e2e-user",
      email: "e2e@test.local",
      username: "e2etester",
      displayName: "E2E Tester",
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
