// Server-side upstream Liner session ("Polaris Mono" service identity).
//
// The upstream lyrics route (GET /v1/tracks/:id/lyrics — the real Liner
// provider the desktop calls "polaris mono") serves word-level lyrics ONLY
// to signed-in Liner accounts: bearer-less calls get 401
// "Sign in to Liner to see lyrics." (verified live 2026-11-14). Upstream
// sessions have their own bearer, but website sessions (guest/Discord) and
// signed-out visitors have none — without a service identity they could
// never see the real Liner lyrics and were stuck on the local lrclib pool.
//
// This module mints and caches ONE upstream session for the relay itself,
// using the same direct-login protocol the browser speaks (POST
// /v1/auth/login {email, password} + HMAC signing via signUpstreamRequest —
// no PoW needed for the direct upstream login, verified live). Credentials
// come from env (LINER_SERVICE_EMAIL / LINER_SERVICE_PASS). Tokens live
// in-process only: a recycled sandbox simply logs in again on the next
// lyrics request.
import { signUpstreamRequest } from "@/lib/upstreamSigner";

const UPSTREAM = "https://api.tryliner.fun";
const CLIENT_VERSION = "1.0.4-desktop";
/** Shared with the standalone upstream probes (admin gate, user directory). */
export const UPSTREAM_CLIENT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) liner-desktop/0.2.12 Chrome/134.0.0.0 Electron/44.0.0 Safari/537.36";

interface ServiceSession {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms after which the access token should be re-minted */
  expiresAt: number;
}

let cached: ServiceSession | null = null;
let loginInFlight: Promise<string | null> | null = null;

/** True when the relay has service credentials configured. */
export function isLinerServiceConfigured(): boolean {
  const email = process.env.LINER_SERVICE_EMAIL?.trim();
  const pass = process.env.LINER_SERVICE_PASS;
  return Boolean(email && pass);
}

async function loginUpstream(
  email: string,
  password: string,
): Promise<ServiceSession | null> {
  const body = JSON.stringify({ email, password });
  const signed = signUpstreamRequest("POST", "/v1/auth/login", body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${UPSTREAM}/v1/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": UPSTREAM_CLIENT_UA,
        "x-client-version": CLIENT_VERSION,
        "x-platform": "web",
        ...signed,
      },
      body,
      signal: controller.signal,
      redirect: "manual",
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return null;
    const data = (await res.json()) as {
      accessToken?: string;
      refreshToken?: string;
      accessTokenExpiresAt?: string;
    };
    if (!data.accessToken) return null;
    const expiresAt = data.accessTokenExpiresAt
      ? Date.parse(data.accessTokenExpiresAt)
      : 0;
    return {
      accessToken: data.accessToken,
      ...(data.refreshToken ? { refreshToken: data.refreshToken } : {}),
      // unknown expiry → re-mint after 50 minutes (desktop access tokens
      // live ~1h; refreshing early is cheaper than a dead lyrics stream)
      expiresAt: Number.isFinite(expiresAt) && expiresAt > 0
        ? expiresAt - 5 * 60_000
        : Date.now() + 50 * 60_000,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A valid upstream bearer for the relay's own upstream calls — cached,
 * single-flight, re-minted when stale. Null when credentials are missing or
 * the upstream login failed (callers fall back to their local providers).
 */
export async function getServiceLinerAccessToken(): Promise<string | null> {
  if (!isLinerServiceConfigured()) return null;
  if (cached && Date.now() < cached.expiresAt) return cached.accessToken;
  if (!loginInFlight) {
    loginInFlight = (async () => {
      try {
        const email = process.env.LINER_SERVICE_EMAIL!.trim();
        const pass = process.env.LINER_SERVICE_PASS!;
        const session = await loginUpstream(email, pass);
        if (!session) return null;
        cached = session;
        return session.accessToken;
      } catch {
        // a failed/flaky upstream login must never throw into a request —
        // callers treat null as "no service identity available" and every
        // home-surface route degrades to its empty-state fallback instead
        // of erroring the browser
        return null;
      }
    })();
    try {
      return await loginInFlight;
    } finally {
      loginInFlight = null;
    }
  }
  return loginInFlight;
}

/** Force a re-login (used when the upstream rejects the cached bearer). */
export async function refreshServiceLinerToken(): Promise<string | null> {
  cached = null;
  return getServiceLinerAccessToken();
}
