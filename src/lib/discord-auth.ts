// Shared Discord REST auth header builders for the relay routes
// (/api/discord/[...path] and /api/discord-asset).
//
// Browsers cannot send the headers Discord's REST expects for either auth
// scheme: bot tokens need the documented `DiscordBot (url, version)`
// User-Agent, user tokens want X-Super-Properties and friends. The relays
// forward the user's token per request (never stored) and decorate it here.

export const DISCORD_API = "https://discord.com/api/v9";
export const UPSTREAM_TIMEOUT_MS = 15_000;

export const BOT_USER_AGENT = "DiscordBot (https://tryliner.fun, 1.0)";
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

function superProperties(): string {
  const props = {
    os: "Windows",
    browser: "Chrome",
    device: "",
    system_locale: "en-US",
    browser_user_agent: BROWSER_USER_AGENT,
    browser_version: "134.0.0.0",
    os_version: "10",
    referrer: "",
    referring_domain: "",
    referrer_current: "",
    referring_domain_current: "",
    release_channel: "stable",
    client_build_number: 395481,
    client_event_source: null,
  };
  return Buffer.from(JSON.stringify(props), "ascii").toString("base64");
}

/** Header set for one Discord REST call under the given auth scheme. */
export function discordAuthHeaders(
  scheme: "bot" | "user",
  token: string,
): Record<string, string> {
  return scheme === "bot"
    ? { Authorization: `Bot ${token}`, "User-Agent": BOT_USER_AGENT }
    : {
        Authorization: token,
        "User-Agent": BROWSER_USER_AGENT,
        "X-Super-Properties": superProperties(),
        "X-Discord-Locale": "en-US",
      };
}

/**
 * Context header the Developer Portal itself sends when creating an
 * application. Creating the per-user artwork application (POST
 * /applications) with a plain user token is rejected without it — and that
 * application is what the whole external-assets artwork chain hangs off.
 */
export const DEV_PORTAL_CONTEXT_PROPERTIES = Buffer.from(
  JSON.stringify({ location: "Developer Portal" }),
  "ascii",
).toString("base64");
