import { asRecord, numberValue, stringValue } from "@/shared/utils/json";
import type { TvOauthClient } from "./tvOauthClient";

const TOKEN_URL = "https://www.youtube.com/o/oauth2/token";

export interface YoutubeAuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt: number;
  scope?: string;
}

export type TvTokenResult =
  | { status: "granted"; tokens: YoutubeAuthTokens }
  | { status: "failed"; error: string; retryable: boolean };

// Errors that mean Google permanently rejected this client/code — retrying
// cannot succeed, so the caller should surface them instead of looping.
const TERMINAL_TOKEN_ERRORS = new Set([
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "access_denied",
  "unsupported_grant_type",
  "invalid_scope",
]);

export class YoutubeAuthError extends Error {
  constructor(public readonly code: string) {
    super(`YouTube sign-in failed: ${code}.`);
    this.name = "YoutubeAuthError";
  }
}

function parseTokenResponse(
  body: unknown,
  fallbackRefreshToken?: string,
): TvTokenResult {
  const record = asRecord(body);
  const error = stringValue(record?.error);
  if (error)
    return {
      status: "failed",
      error,
      retryable: !TERMINAL_TOKEN_ERRORS.has(error),
    };
  const accessToken = stringValue(record?.access_token);
  const refreshToken =
    stringValue(record?.refresh_token) ?? fallbackRefreshToken;
  if (!accessToken || !refreshToken) {
    // A 5xx proxy/upstream body (or truncated payload) is transport noise —
    // the device grant stays valid, so the caller can simply poll again.
    return { status: "failed", error: "invalid_response", retryable: true };
  }
  const scope = stringValue(record?.scope);
  return {
    status: "granted",
    tokens: {
      accessToken,
      refreshToken,
      tokenType: stringValue(record?.token_type) ?? "Bearer",
      expiresAt: Date.now() + (numberValue(record?.expires_in) ?? 3600) * 1000,
      ...(scope ? { scope } : {}),
    },
  };
}

export async function requestTvToken(
  grant: Record<string, string>,
  signal?: AbortSignal,
  fallbackRefreshToken?: string,
): Promise<TvTokenResult> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(grant),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    // Network-level failure (stale socket through the web proxy, etc.):
    // retrying the same poll is always safe — nothing was consumed.
    return { status: "failed", error: "network_error", retryable: true };
  }
  const body = (await response.json().catch(() => null)) as unknown;
  const result = parseTokenResponse(body, fallbackRefreshToken);
  if (result.status === "granted" && !response.ok) {
    return {
      status: "failed",
      error: `http_${response.status}`,
      retryable: response.status >= 500,
    };
  }
  return result;
}

export async function refreshTvTokens(
  client: TvOauthClient,
  refreshToken: string,
  signal?: AbortSignal,
): Promise<YoutubeAuthTokens> {
  const result = await requestTvToken(
    {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    },
    signal,
    refreshToken,
  );
  if (result.status === "failed") throw new YoutubeAuthError(result.error);
  return result.tokens;
}

export function toAuthorizationHeader(tokens: YoutubeAuthTokens): string {
  return `${tokens.tokenType} ${tokens.accessToken}`;
}
