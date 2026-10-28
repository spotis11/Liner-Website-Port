// Task 27-b E2E init — simulate a browser that was already walled before:
// seed the persisted ban record the new banStore hydrates from, including
// the profile picture captured at ban time (inline SVG data URI so it
// renders in the sandbox without network access).
(function () {
  var avatar =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%238b5cf6'/><stop offset='1' stop-color='%236366f1'/></linearGradient></defs><rect width='96' height='96' fill='url(%23g)'/><circle cx='34' cy='40' r='7' fill='white'/><circle cx='62' cy='40' r='7' fill='white'/><path d='M30 62c5 7 31 7 36 0' stroke='white' stroke-width='4' fill='none' stroke-linecap='round'/></svg>";
  try {
    localStorage.setItem(
      "liner_web_ban_v1",
      JSON.stringify({
        username: "e2ebanned",
        type: "normal",
        reason: "e2e test ban",
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: null,
        avatarUrl: avatar,
      }),
    );
  } catch (e) {}
})();
