// Task 28-b E2E: seed a ZOMBIE session (access token without a refresh
// token — the exact poison the owner's browser likely holds) before the app
// boots. Expected: the app drops it at initialize() and shows a clean login
// screen instead of a half-broken state with "session expired" toasts.
(() => {
  try {
    localStorage.setItem(
      "liner_auth_session",
      JSON.stringify({
        accessToken: "zombie-dead-token",
        refreshToken: "",
        accessTokenExpiresAt: new Date(Date.now() - 7_200_000).toISOString(),
        user: {
          id: "z1",
          email: "zombie@test.local",
          username: "jayzeyluna",
          displayName: "JayJoice",
        },
      }),
    );
  } catch {}
})();
