import crypto from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Discord OAuth2 (Authorization Code + PKCE) for the website login system.
 *
 * WHY PKCE ALWAYS: the Discord developer portal may classify the app as a
 * public client (the portal's own text says public clients cannot hold
 * secrets). We send the client secret when one is configured AND always send
 * a PKCE challenge — the flow works whether the portal toggle says public or
 * confidential. If the token endpoint rejects the secret (invalid_client,
 * which public clients hit), the exchange retries once WITHOUT the secret;
 * PKCE alone proves the request came from our own /start redirect.
 *
 * STATE/VERIFIER: random values minted by /api/auth/discord/start and stored
 * in a short-lived HttpOnly cookie ("state.verifier"). The callback compares
 * the ?state= query param against the cookie half and uses the verifier half
 * for the token exchange — a forged callback without our cookie fails.
 *
 * ENDPOINTS: base URLs are overridable so the whole flow can be exercised
 * against a local mock in E2E (DISCORD_API_BASE / DISCORD_AUTHORIZE_BASE);
 * production defaults are the real Discord endpoints.
 */

const DEFAULT_API_BASE = "https://discord.com/api";
const DEFAULT_AUTHORIZE_BASE = "https://discord.com/oauth2/authorize";

export const DISCORD_OAUTH_COOKIE = "liner_discord_oauth";
/** state/verifier cookie lifetime — the user has 10 minutes to finish. */
export const DISCORD_OAUTH_COOKIE_MAX_AGE = 600;
const SCOPES = "identify email";

export interface DiscordConfig {
  clientId: string;
  clientSecret: string | null;
  apiBase: string;
  authorizeBase: string;
}

export function getDiscordConfig(): DiscordConfig | null {
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  if (!clientId) return null;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim() || null;
  return {
    clientId,
    clientSecret,
    apiBase: process.env.DISCORD_API_BASE?.trim() || DEFAULT_API_BASE,
    authorizeBase:
      process.env.DISCORD_AUTHORIZE_BASE?.trim() || DEFAULT_AUTHORIZE_BASE,
  };
}

/** Origin the browser is actually talking to (proxy-aware, env-overridable). */
export function getDiscordPublicBase(req: NextRequest): string {
  const fromEnv = process.env.DISCORD_PUBLIC_BASE?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (req.nextUrl.protocol.replace(/:$/, "") || "http");
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return `${proto}://${host}`;
}

export function getDiscordRedirectUri(req: NextRequest): string {
  const fromEnv = process.env.DISCORD_REDIRECT_URI?.trim();
  if (fromEnv) return fromEnv;
  return `${getDiscordPublicBase(req)}/api/auth/discord/callback`;
}

// ---- PKCE / state -----------------------------------------------------------

export interface DiscordOAuthChallenge {
  state: string;
  verifier: string;
  challenge: string;
}

export function mintChallenge(): DiscordOAuthChallenge {
  const state = crypto.randomBytes(16).toString("base64url");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { state, verifier, challenge };
}

/** Cookie value format: "<state>.<verifier>" — neither contains a dot. */
export function packOAuthCookie(challenge: DiscordOAuthChallenge): string {
  return `${challenge.state}.${challenge.verifier}`;
}

export function unpackOAuthCookie(
  value: string | undefined | null,
): { state: string; verifier: string } | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return null;
  return { state: value.slice(0, dot), verifier: value.slice(dot + 1) };
}

// ---- authorize URL ----------------------------------------------------------

export function buildAuthorizeUrl(input: {
  config: DiscordConfig;
  redirectUri: string;
  challenge: DiscordOAuthChallenge;
}): string {
  const url = new URL(input.config.authorizeBase);
  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", input.challenge.state);
  url.searchParams.set("code_challenge", input.challenge.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

// ---- token exchange ---------------------------------------------------------

export interface DiscordTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
}

interface DiscordTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}

async function postTokenForm(
  form: Record<string, string>,
  apiBase: string,
): Promise<DiscordTokenResponse> {
  const response = await fetch(`${apiBase}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Liner-Website-Port (Discord OAuth)",
    },
    body: new URLSearchParams(form).toString(),
    cache: "no-store",
  });
  const json = (await response.json().catch(() => ({}))) as DiscordTokenResponse;
  if (!response.ok) {
    throw new DiscordOAuthError(
      "token_exchange_failed",
      json.error_description ||
        json.error ||
        `Discord token endpoint returned ${response.status}`,
    );
  }
  return json;
}

export class DiscordOAuthError extends Error {
  constructor(
    public readonly code:
      | "token_exchange_failed"
      | "profile_failed"
      | "missing_code",
    message: string,
  ) {
    super(message);
    this.name = "DiscordOAuthError";
  }
}

export async function exchangeDiscordCode(input: {
  config: DiscordConfig;
  code: string;
  redirectUri: string;
  verifier: string;
}): Promise<DiscordTokens> {
  const { config, code, redirectUri, verifier } = input;
  const base: Record<string, string> = {
    client_id: config.clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  };

  // confidential first (portal secret); public-client portals reject the
  // secret — retry once without it, PKCE still protects the exchange.
  if (config.clientSecret) {
    try {
      const withSecret = await postTokenForm(
        { ...base, client_secret: config.clientSecret },
        config.apiBase,
      );
      return toTokens(withSecret);
    } catch (err) {
      const invalidClient =
        err instanceof DiscordOAuthError && /invalid_client/i.test(err.message);
      if (!invalidClient) throw err;
      console.warn(
        "[auth/discord] client_secret rejected (public client?) — retrying with PKCE only",
      );
    }
  }
  const withoutSecret = await postTokenForm(base, config.apiBase);
  return toTokens(withoutSecret);
}

function toTokens(json: DiscordTokenResponse): DiscordTokens {
  if (!json.access_token) {
    throw new DiscordOAuthError(
      "token_exchange_failed",
      "Discord token response had no access_token",
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresIn: json.expires_in ? Number(json.expires_in) : null,
  };
}

// ---- profile ----------------------------------------------------------------

export interface DiscordProfile {
  id: string;
  username: string;
  globalName: string | null;
  email: string | null;
  avatarUrl: string;
}

interface DiscordUserResponse {
  id?: string;
  username?: string;
  global_name?: string | null;
  email?: string | null;
  avatar?: string | null;
  verified?: boolean;
}

export async function fetchDiscordProfile(
  accessToken: string,
  apiBase: string,
): Promise<DiscordProfile> {
  const response = await fetch(`${apiBase}/users/@me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "Liner-Website-Port (Discord OAuth)",
    },
    cache: "no-store",
  });
  const json = (await response.json().catch(() => ({}))) as DiscordUserResponse;
  if (!response.ok || !json.id || !json.username) {
    throw new DiscordOAuthError(
      "profile_failed",
      json.error_description || `Discord /users/@me returned ${response.status}`,
    );
  }
  return {
    id: json.id,
    username: json.username,
    globalName: json.global_name ?? null,
    email: json.email ?? null,
    avatarUrl: discordAvatarUrl(json.id, json.avatar),
  };
}

/** Discord CDN avatar (gif for animated hashes, else png), with a stable default. */
export function discordAvatarUrl(
  userId: string,
  avatarHash: string | null | undefined,
): string {
  if (avatarHash) {
    const ext = avatarHash.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=256`;
  }
  let index = 0;
  try {
    // pre-2025 default-avatar index from the user id (old algorithm, stable)
    index = Number((BigInt(userId) >> 22n) % 6n);
  } catch {
    index = 0;
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}
