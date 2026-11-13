/**
 * Browser-side Liner upstream session (api.tryliner.fun) — desktop parity
 * for word-level lyrics ("Polaris Mono" / "binimum" are served ONLY to
 * signed-in Liner accounts; lrclib is the anonymous fallback).
 *
 * ROUTING (WAF rules): the upstream API sits behind Cloudflare which the
 * upstream README explicitly warns about — browsers can be CORS-blocked or
 * challenged on cross-origin calls. Requests therefore go through OUR
 * website's same-origin relay (the Next.js /v1 backend forwards to the
 * upstream with the desktop's Electron UA):
 *   - refresh  -> relayed (no password involved; server IP passes CF)
 *   - login    -> still browser-direct (real-browser CF pass, and the
 *                 password must never touch our server)
 *   - lyrics   -> relayed via /v1/tracks/:id/lyrics?upstream=1 (see api.ts)
 * The signature is computed in the browser over the UPSTREAM path; the relay
 * forwards path + x-liner-* headers byte-for-byte, so it stays valid.
 *
 * Request signing mirrors the desktop's native signer (signer/src/crypto.rs
 * + electron/crypto.ts — public constants from the official repo):
 *   key  = obfuscated key XOR SHA256(seed||i) keystream
 *   sig  = HMAC-SHA256(key, "METHOD\npath\ntimestamp\nnonce\nsha256(body)")
 *          base64url, sent as x-liner-signature/-timestamp/-nonce.
 *
 * The session is stored separately from the website auth session — the
 * website Bearer and the Liner Bearer are two different trust domains.
 */

import { getApiBaseUrl } from "./baseUrl";
import { getAuthSession } from "./auth-session";

const LINER_UPSTREAM_BASE = "https://api.tryliner.fun";
const SESSION_KEY = "liner_liner_session_v1";
const CLIENT_VERSION = "1.0.4-desktop";
const REFRESH_MARGIN_MS = 120_000;

/** Website access/refresh tokens are always `at_`/`rt_`-prefixed. */
function isWebsiteToken(token: string): boolean {
  return token.startsWith("at_") || token.startsWith("rt_");
}

interface LinerSession {
  email: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt?: string;
  savedAt: number;
}

// ---- key derivation (same obfuscated constants as the official signer) ----

const OBF_API_SEED = Uint8Array.from([
  0x55, 0xc3, 0x5c, 0xaa, 0x3f, 0x3c, 0x32, 0x6d, 0xaa, 0x63, 0x0f, 0x90,
  0x39, 0x5d, 0x66, 0x36,
]);
const OBF_API_KEY = Uint8Array.from([
  0x24, 0x99, 0x56, 0x2b, 0x80, 0x20, 0xc1, 0xb7, 0xf6, 0x7d, 0x74, 0x91,
  0xe4, 0xc3, 0x7f, 0x67, 0x1a, 0x0e, 0x8a, 0xf3, 0x7f, 0x50, 0xaf, 0x2e,
  0x05, 0xd5, 0xa7, 0xb0, 0xbe, 0x6e, 0x31, 0x11, 0x40, 0xf3, 0x42, 0xad,
  0x31, 0xf6, 0xcb, 0xea, 0xb5, 0xba, 0xdd, 0xd0, 0x8e, 0x56, 0x55, 0x8c,
  0xb4, 0xe5, 0x1d, 0x82, 0x69, 0x0c, 0x3f, 0xb2, 0x30, 0x82, 0xa7, 0xf4,
  0x9b, 0xba, 0x9b, 0x70,
]);
const API_KEY_CHECKSUM = Uint8Array.from([
  0xe2, 0x09, 0x02, 0x55, 0x83, 0xee, 0xf0, 0x07,
]);

let signerKey: CryptoKey | null = null;
let signerClockOffsetMs = 0;

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function deriveSignerKey(): Promise<CryptoKey> {
  if (signerKey) return signerKey;
  let ks = new Uint8Array(0);
  for (let i = 0; ks.length < 64; i = (i + 1) & 0xff) {
    const block = await sha256(concat(OBF_API_SEED, Uint8Array.of(i)));
    ks = concat(ks, block);
  }
  const key = new Uint8Array(64);
  for (let idx = 0; idx < 64; idx++) key[idx] = OBF_API_KEY[idx] ^ ks[idx];
  const digest = await sha256(key);
  for (let idx = 0; idx < 8; idx++) {
    if (digest[idx] !== API_KEY_CHECKSUM[idx]) {
      throw new Error("liner signer key derivation failed");
    }
  }
  signerKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return signerKey;
}

export async function signLinerRequest(
  method: string,
  path: string,
  body = "",
): Promise<Record<string, string>> {
  try {
    const key = await deriveSignerKey();
    const timestamp = Math.floor((Date.now() + signerClockOffsetMs) / 1000);
    const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(8)));
    const bodySha = await sha256(new TextEncoder().encode(body));
    const canonical = `${method.toUpperCase().trim()}\n${path.split("?")[0].trim()}\n${timestamp}\n${nonce}\n${Array.from(bodySha)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}`;
    const mac = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(canonical) as Uint8Array<ArrayBuffer>,
    );
    return {
      "x-liner-signature": bytesToBase64Url(new Uint8Array(mac)),
      "x-liner-timestamp": String(timestamp),
      "x-liner-nonce": nonce,
    };
  } catch {
    // an unsigned request is better than a broken one — upstream will
    // answer 401 and the caller falls back to the same-origin provider
    return {};
  }
}

/** Sync the signing clock from a Date response header (desktop parity). */
export function syncLinerServerTime(dateHeader: string | null | undefined): void {
  if (!dateHeader) return;
  const serverMs = Date.parse(dateHeader);
  if (!Number.isNaN(serverMs) && serverMs > 0) {
    signerClockOffsetMs = serverMs - Date.now();
  }
}

// ---- session store ---------------------------------------------------------

function readSession(): LinerSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LinerSession;
    return parsed?.accessToken && parsed?.refreshToken ? parsed : null;
  } catch {
    return null;
  }
}

function writeSession(session: LinerSession | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
}

/** True when this browser holds a Liner upstream session. */
export function hasLinerSession(): boolean {
  return readSession() !== null;
}

export function forgetLinerSession(): void {
  writeSession(null);
}

function expiryMs(session: LinerSession): number | null {
  if (!session.accessTokenExpiresAt) return null;
  const ms = Date.parse(session.accessTokenExpiresAt);
  return Number.isNaN(ms) ? null : ms;
}

interface UpstreamAuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt?: string;
}

async function upstreamCall(
  path: string,
  body: Record<string, unknown>,
  bearer?: string,
  mode: "relay" | "direct" = "relay",
): Promise<{ ok: boolean; status: number; json: UpstreamAuthTokens | null }> {
  const bodyText = JSON.stringify(body);
  const signed = await signLinerRequest("POST", path, bodyText);
  // relay = same-origin (our /v1 backend forwards to the upstream — no CORS);
  // direct = straight to api.tryliner.fun (Electron keeps doing this itself;
  // in the browser only login uses it, to keep the password off our server)
  const base = mode === "relay" ? getApiBaseUrl() : LINER_UPSTREAM_BASE;
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-client-version": CLIENT_VERSION,
        "x-platform": "web",
        ...signed,
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: bodyText,
    });
  } catch {
    return { ok: false, status: 0, json: null };
  }
  syncLinerServerTime(res.headers.get("date"));
  let json: UpstreamAuthTokens | null = null;
  try {
    json = (await res.json()) as UpstreamAuthTokens;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

/**
 * Sign in to the upstream Liner API directly from the browser (the same
 * protocol the desktop app speaks; Cloudflare passes from real browsers).
 * Fire-and-forget safe: returns false on any failure without throwing.
 */
export async function linerLoginUpstream(
  email: string,
  password: string,
): Promise<boolean> {
  if (!email || !password) return false;
  // direct on purpose: real browsers pass Cloudflare on POST login, and the
  // password must never transit our server
  const res = await upstreamCall(
    "/v1/auth/login",
    {
      email: email.trim(),
      password,
    },
    undefined,
    "direct",
  );
  const tokens = res.json;
  if (!res.ok || !tokens?.accessToken || !tokens?.refreshToken) return false;
  writeSession({
    email: email.trim(),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    ...(tokens.accessTokenExpiresAt
      ? { accessTokenExpiresAt: tokens.accessTokenExpiresAt }
      : {}),
    savedAt: Date.now(),
  });
  return true;
}

/**
 * A fresh upstream access token, refreshing proactively when it is about to
 * expire (desktop parity: <120s margin, single-flight refresh). Rotated
 * refresh tokens are persisted immediately.
 *
 * v1.26 BRIDGE: since the upstream-parity switch, an upstream Liner login
 * stores its tokens in the MAIN auth session (one sign-in, one session) —
 * there is no separate liner session any more. When this browser has no
 * separate session, the main session's token is used IF it is an upstream
 * token (website sessions are `at_`/`rt_`-prefixed and are a different
 * trust domain — their bearer is worthless to api.tryliner.fun).
 */
let refreshInFlight: Promise<string | null> | null = null;

export async function getValidLinerAccessToken(): Promise<string | null> {
  const session = readSession();
  if (!session) {
    const main = getAuthSession();
    const token = main?.accessToken ?? null;
    return token && !isWebsiteToken(token) ? token : null;
  }
  const expiresAt = expiryMs(session);
  const stale =
    expiresAt !== null
      ? expiresAt - Date.now() < REFRESH_MARGIN_MS
      : Date.now() - session.savedAt > 10 * 60_000;
  if (!stale) return session.accessToken;

  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const res = await upstreamCall(
      "/v1/auth/refresh",
      { refreshToken: session.refreshToken },
    );
    const tokens = res.json;
    if (res.ok && tokens?.accessToken && tokens?.refreshToken) {
      const next: LinerSession = {
        ...session,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        ...(tokens.accessTokenExpiresAt
          ? { accessTokenExpiresAt: tokens.accessTokenExpiresAt }
          : {}),
        savedAt: Date.now(),
      };
      writeSession(next);
      refreshInFlight = null;
      return next.accessToken;
    }
    // refresh failed — the current token is the best we have while it lasts
    refreshInFlight = null;
    if (expiresAt !== null && expiresAt > Date.now()) return session.accessToken;
    return null;
  })();
  return refreshInFlight;
}
