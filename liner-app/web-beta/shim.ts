/*
 * Liner 0.2.20 beta renderer — web shell shim.
 *
 * The beta ships only as a minified Electron renderer (no public source),
 * so the website port runs it unmodified and provides everything a browser
 * lacks at RUNTIME, before the app module is evaluated:
 *
 *   1. fetch interceptor  — reroutes cross-origin upstreams through the
 *      same-origin fan-server proxies (same idea as the 0.2.12 port's
 *      src/shared/lib/webProxy.ts, retargeted for the 0.2.20 beta host map:
 *      the beta's API base is baked to staging.tryliner.fun; both it and the
 *      stable api host now ride the same-origin /v1 dual-mode relay so the
 *      bans wall, website sessions and the lyrics relay keep working).
 *   2. window.linerElectron — a web bridge with the exact surface the 0.2.20
 *      renderer touches (verified against the minified bundles): real
 *      WebCrypto request signing (proven scheme from the 0.2.12 port's
 *      requestSigner.ts), sane no-ops for window/overlay/touchbar/discord/
 *      caches/local-tracks, and version reporting. authSession is
 *      deliberately NOT implemented — the renderer then persists sessions in
 *      localStorage `liner_auth_session`, which is exactly where the fan
 *      guest/Discord sessions live.
 *   3. fan login — the beta login page has no guest/Discord sign-in, so the
 *      shim injects both buttons (wired to the fan server's /api/auth/*)
 *      and consumes the Discord OAuth fragment (#/auth/discord?at=…&rt=…).
 */

// ---------------------------------------------------------------------------
// request signer (WebCrypto port of liner-app/src/shared/api/requestSigner.ts)
// ---------------------------------------------------------------------------

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

let serverTimeOffsetMs = 0;
let signerKey: CryptoKey | null = null;

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
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
    const block = await sha256Bytes(concatBytes(OBF_API_SEED, Uint8Array.of(i)));
    ks = concatBytes(ks, block);
  }
  const key = new Uint8Array(64);
  for (let idx = 0; idx < 64; idx++) key[idx] = OBF_API_KEY[idx] ^ ks[idx];
  const digest = await sha256Bytes(key);
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

async function signApiRequest(
  method: string,
  path: string,
  body?: string | null,
  customTimestamp?: number,
): Promise<Record<string, string>> {
  try {
    const key = await deriveSignerKey();
    const timestamp = customTimestamp ?? Math.floor((Date.now() + serverTimeOffsetMs) / 1000);
    const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(8)));
    const bodySha = await sha256Bytes(new TextEncoder().encode(body ?? ""));
    const canonical = `${method.toUpperCase().trim()}\n${path.split("?")[0].trim()}\n${timestamp}\n${nonce}\n${Array.from(bodySha)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}`;
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical));
    return {
      "x-liner-signature": bytesToBase64Url(new Uint8Array(mac)),
      "x-liner-timestamp": String(timestamp),
      "x-liner-nonce": nonce,
    };
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// web proxy map (0.2.20 beta host surface)
// ---------------------------------------------------------------------------

const SAME_ORIGIN_BYPASS = ["blob:", "data:", "about:", "chrome:", "resource:"];

const MEDIA_HOSTS = [
  "googlevideo.com",
  "sndcdn.com",
  "ytimg.com",
  "googleusercontent.com",
  "tryliner.fun",
  "tryliner.com",
  "r2.dev",
  "r2.cloudflarestorage.com",
  "amazonaws.com",
  "pinimg.com",
  "clstorage.net",
  "soundcloud.com",
];

const FETCH_HOSTS = [
  "soundcloud.com",
  "a-v2.sndcdn.com",
  "www.youtube.com",
  "youtube.com",
  "oauth2.googleapis.com",
  "api.deezer.com",
  "www.deezer.com",
  "api.music.apple.com",
  "music.apple.com",
  "open.spotify.com",
  "clienttoken.spotify.com",
  "api-partner.spotify.com",
  "open.spotifycdn.com",
  "api.genius.com",
  "genius.com",
  "images.genius.com",
  "api.github.com",
  "github.com",
  "gstatic.com",
  // BotGuard challenge + integrity token endpoints (PoToken minting)
  "jnn-pa.googleapis.com",
  "google.com", // interpreter script host (www.google.com/js/th/...)
];

// the beta's API hosts: every /v1 call rides the same-origin dual-mode relay
// (website sessions, bans wall, lyrics relay all live there)
const LINER_API_HOSTS = new Set(["staging.tryliner.fun", "api.tryliner.fun"]);

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith("." + suffix);
}

function rewriteForWeb(rawUrl: string, method?: string): string {
  if (!rawUrl) return rawUrl;
  if (SAME_ORIGIN_BYPASS.some((scheme) => rawUrl.startsWith(scheme))) return rawUrl;
  if (rawUrl.startsWith("/")) return rawUrl;
  if (typeof window === "undefined") return rawUrl;

  let url: URL;
  try {
    url = new URL(rawUrl, window.location.origin);
  } catch {
    return rawUrl;
  }
  if (url.origin === window.location.origin) return rawUrl;

  const host = url.hostname;

  // Liner API (beta staging + stable api): relay everything through the
  // same-origin /v1 surface. The relay forwards signatures byte-for-byte
  // over the upstream path, and the shim signs with the same scheme, so the
  // signature stays valid across the hop.
  if (LINER_API_HOSTS.has(host)) {
    if (url.pathname === "/v1" || url.pathname.startsWith("/v1/")) {
      return `${url.pathname}${url.search}`;
    }
    // the beta probes its API base at /health — the relay answers that
    // locally at /v1/health (no upstream round-trip, feeds the outage modal)
    if (url.pathname === "/health") {
      return "/v1/health";
    }
    return `/api/fetch?u=${encodeURIComponent(url.toString())}`;
  }

  // Innertube (youtubei.js default host googleapis + explicit youtube hosts).
  // TV profiles pick www.youtube.com explicitly (PRODUCTION_1) and keep their
  // dedicated /api/yt/www proxy; googleapis (PRODUCTION_2) and
  // music.youtube.com ride the WEB_REMIX /api/yt proxy.
  if (host === "youtubei.googleapis.com" && url.pathname.startsWith("/youtubei")) {
    const rest = `${url.pathname.slice("/youtubei".length)}${url.search}`;
    return `/api/yt${rest}`;
  }
  if (
    hostMatches(host, "youtube.com") &&
    (url.pathname.startsWith("/youtubei/") || url.pathname === "/youtubei")
  ) {
    const rest = `${url.pathname.slice("/youtubei".length)}${url.search}`;
    return host === "www.youtube.com" ? `/api/yt/www${rest}` : `/api/yt${rest}`;
  }

  // SABR UMP streaming POSTs
  if (hostMatches(host, "youtube.com") || hostMatches(host, "googlevideo.com")) {
    const isManifestPath =
      url.pathname === "/api/manifest" || url.pathname.startsWith("/api/manifest/");
    const isVideoPlaybackPath = url.pathname === "/videoplayback";
    if (isManifestPath || (isVideoPlaybackPath && method?.toUpperCase() === "POST")) {
      return `/api/yt/sabr?u=${encodeURIComponent(url.toString())}`;
    }
  }

  // SoundCloud API + script host
  if (host === "api-v2.soundcloud.com") {
    return `/api/sc${url.pathname}${url.search}`;
  }
  if (hostMatches(host, "a-v2.sndcdn.com")) {
    return `/api/fetch?u=${encodeURIComponent(url.toString())}`;
  }

  if (MEDIA_HOSTS.some((suffix) => hostMatches(host, suffix))) {
    return `/api/media?u=${encodeURIComponent(url.toString())}`;
  }
  if (FETCH_HOSTS.some((suffix) => hostMatches(host, suffix))) {
    return `/api/fetch?u=${encodeURIComponent(url.toString())}`;
  }
  return rawUrl;
}

function installWebFetchProxy(): void {
  if (typeof window === "undefined" || typeof window.fetch === "undefined") return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (typeof input === "string" || input instanceof URL) {
      const raw = input.toString();
      const rewritten = rewriteForWeb(raw, init?.method);
      tapVisitorData(init);
      if (rewritten === raw) return originalFetch(input as RequestInfo, init);
      return originalFetch(rewritten, init);
    }
    const rewritten = rewriteForWeb(input.url, input.method);
    if (rewritten === input.url) return originalFetch(input, init);
    const request = new Request(rewritten, input);
    return originalFetch(request, init);
  };
}

// ---------------------------------------------------------------------------
// YouTube PoToken minting (BotGuard via bgutils-js)
//
// The 0.2.20 renderer moved PoToken minting to the electron main process
// (window.linerElectron.mintPoToken) and REFUSES anonymous playback without
// it ("PO tokens need a newer Liner app version", 501). The web bridge
// mints with bgutils-js in the page: challenge from jnn-pa, VM snapshot,
// GenerateIT integrity token, WebPoMinter — content-bound to the video id.
// ---------------------------------------------------------------------------

import { BotGuardClient, parseChallengeData } from "bgutils-js/botguard";
import { WebPoMinter, createColdStartToken } from "bgutils-js/webpo";
import { GOOG_API_KEY, GOOG_BASE_URL } from "bgutils-js/utils";

const BOTGUARD_REQUEST_KEY = "O43z0dpjhgX20SCx4KAo"; // WEB request key

// the app's own innertube visitor data, tapped from proxied /api/yt bodies
// (the minter binds to it when present so tokens match the request context)
let tappedVisitorData: string | null = null;

function tapVisitorData(init?: RequestInit): void {
  const body = init?.body;
  if (typeof body === "string" && body.includes("visitorData")) {
    const match = body.match(/"visitorData":"([^"]+)"/);
    if (match?.[1]) tappedVisitorData = match[1];
  }
}

interface IntegrityTokenResponse {
  integrityToken?: string;
  estimatedTtlSecs: number;
  mintRefreshThreshold: number;
  websafeFallbackToken?: string;
}

let minterCache: { minter: WebPoMinter; expiresAt: number } | null = null;
let minterInFlight: Promise<WebPoMinter> | null = null;

// mirrors the desktop preload's mintPoToken flow exactly:
//   1. challenge from innertube /youtubei/v1/att/get (WEB, UNBOUND)
//   2. interpreter = challenge script, or fetched from its gstatic url
//   3. Function(interpreter)() defines globalThis[globalName]
//   4. BotGuardClient snapshot -> webPoSignalOutput + botguard token
//   5. GenerateIT [requestKey, token] -> integrity token (base64url)
//   6. WebPoMinter.mintAsWebsafeString(videoId), cached for the ttl
const BOTGUARD_CLIENT_VERSION = "2.20250925.01.00";

interface ParsedChallenge {
  program: string;
  globalName: string;
  interpreterScript?: string;
  interpreterUrl?: string;
}

function parseLooseJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // the ytAtN payload may use loose JSON — fall back to evaluating it
    return new Function(`return (${raw})`)() as Record<string, unknown>;
  }
}

interface ParsedChallenge {
  program: string;
  globalName: string;
  interpreterScript?: string;
  interpreterUrl?: string;
}

// mirrors bgutil-ytdlp-pot-provider's patched flow: /att/get tokens are
// rejected nowadays — the VM must be fed the YouTube homepage's
// (ytcfg, ytAtN) pair, because BotGuard reads yt.config_.EVENT_ID while
// snapshotting. Without it the VM degrades to a "$"-token and never hands
// out the WebPo minter function.
async function fetchBotguardChallenge(): Promise<ParsedChallenge> {
  const pageRes = await fetch("https://www.youtube.com/", {
    headers: { "accept-language": "en-US,en;q=0.9" },
  });
  if (!pageRes.ok) throw new Error(`homepage fetch ${pageRes.status}`);
  const pageHtml = await pageRes.text();

  const ytcfgMatch = pageHtml.match(/ytcfg\.set\(({.+?})\);/s);
  if (ytcfgMatch) {
    const ytObj = { config_: JSON.parse(ytcfgMatch[1] as string) };
    (globalThis as unknown as Record<string, unknown>).yt = ytObj;
    (globalThis as unknown as { window?: Record<string, unknown> }).window!.yt =
      ytObj;
  } else {
    console.warn("[liner-web] homepage-challenge: no ytcfg found");
  }

  const attMatch = pageHtml.match(/window\.ytAtN\(\s*({[\s\S]*?})\s*\)/);
  if (!attMatch) {
    throw new Error("homepage-challenge: no ytAtN challenge in page");
  }
  const attData = parseLooseJson(attMatch[1] as string) as {
    R?: { bgChallenge?: Record<string, unknown> };
  };
  const bgChallenge = attData?.R?.bgChallenge as {
    program?: string;
    globalName?: string;
    interpreterUrl?: {
      privateDoNotAccessOrElseTrustedResourceUrlWrappedValue?: string;
    };
    interpreterJavascript?: {
      privateDoNotAccessOrElseSafeScriptWrappedValue?: string;
    };
  } | undefined;
  if (!bgChallenge?.program || !bgChallenge.interpreterUrl) {
    throw new Error("homepage-challenge: ytAtN payload missing bgChallenge");
  }
  const script =
    bgChallenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
  let url =
    bgChallenge.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
  if (url?.startsWith("//")) url = `https:${url}`;
  if (!bgChallenge.globalName) {
    throw new Error("homepage-challenge: bgChallenge missing globalName");
  }
  return {
    program: bgChallenge.program,
    globalName: bgChallenge.globalName,
    ...(script ? { interpreterScript: script } : {}),
    ...(url ? { interpreterUrl: url } : {}),
  };
}

async function resolveInterpreterScript(challenge: ParsedChallenge): Promise<string> {
  if (challenge.interpreterScript) return challenge.interpreterScript;
  // the desktop main fetches this for the renderer (no CORS on gstatic) —
  // the web shell rides the same-origin generic proxy
  const text = await (
    await fetch(challenge.interpreterUrl as string)
  ).text();
  if (!text || text.length < 64) {
    throw new Error("BotGuard interpreter download failed");
  }
  return text;
}

async function getWebPoMinter(): Promise<WebPoMinter> {
  if (minterCache && Date.now() < minterCache.expiresAt) return minterCache.minter;
  if (minterInFlight) return minterInFlight;
  minterInFlight = (async () => {
    const challenge = await fetchBotguardChallenge();
    const interpreterJs = await resolveInterpreterScript(challenge);
    // evaluate the VM bootstrap: defines globalThis[challenge.globalName]
    Function(interpreterJs)();
    const botguard = await BotGuardClient.create({
      globalName: challenge.globalName,
      globalObject: globalThis,
      program: challenge.program,
    });
    const webPoSignalOutput: unknown[] = [];
    const botguardToken = await botguard.snapshot({ webPoSignalOutput });
    console.info(
      "[liner-web] webPoSignalOutput:",
      JSON.stringify(
        webPoSignalOutput.map((fn) => (typeof fn === "function" ? "fn" : typeof fn)),
      ),
      "| tokenHead:",
      String(botguardToken).slice(0, 96),
      "| tokenType:",
      typeof botguardToken,
    );
    const res = await fetch(`${GOOG_BASE_URL}/$rpc/google.internal.waa.v1.Waa/GenerateIT`, {
      method: "POST",
      headers: {
        "content-type": "application/json+protobuf",
        "x-goog-api-key": GOOG_API_KEY,
        "x-user-agent": "grpc-web-javascript/0.1",
      },
      body: JSON.stringify([BOTGUARD_REQUEST_KEY, botguardToken]),
    });
    if (!res.ok) throw new Error(`GenerateIT returned ${res.status}`);
    const rawIt = (await res.json()) as unknown;
    console.info(
      "[liner-web] GenerateIT raw:",
      JSON.stringify(rawIt)?.slice(0, 260),
      "| botguardTokenLen:",
      String(botguardToken).length,
    );
    const arr = Array.isArray(rawIt) ? (rawIt as [string | null, number, unknown, string | null]) : undefined;
    // [integrityToken, ttlSecs, mintRefreshThreshold, websafeFallbackToken] —
    // YouTube serves the fallback slot when the primary stays empty; both are
    // the same integrity token (the fallback is already base64url)
    const picked = arr?.[0] || arr?.[3];
    const ttlSeconds = arr?.[1];
    if (!picked) throw new Error("GenerateIT returned no integrity token");
    const minter = await WebPoMinter.create(
      {
        integrityToken: picked.replace(/\+/g, "-").replace(/\//g, "_"),
      },
      webPoSignalOutput as never,
    );
    const ttlSecs = ttlSeconds && ttlSeconds > 0 ? Math.min(ttlSeconds, 21600) : 3600;
    minterCache = { minter, expiresAt: Date.now() + Math.max(ttlSecs * 1000 - 600_000, 60_000) };
    return minter;
  })();
  try {
    return await minterInFlight;
  } finally {
    minterInFlight = null;
  }
}

async function mintPoToken(videoId: string): Promise<string> {
  try {
    const minter = await getWebPoMinter();
    // the player-request po token must be bound to the VISITOR the app's
    // innertube session uses (yt-dlp/bgutil semantics); fall back to the
    // video id when no visitor has been tapped yet
    const binding = tappedVisitorData || videoId;
    console.info("[liner-web] minting po token: binding=", binding ? `${binding.slice(0, 12)}…(${binding.length})` : "EMPTY", "| requested-for:", videoId);
    return await minter.mintAsWebsafeString(binding);
  } catch (error) {
    // full BotGuard minting unavailable (the VM did not hand out a minter) —
    // degrade to a cold-start token, which streams while the content's
    // stream-protection status is still 2
    console.warn("[liner-web] botguard mint failed, using cold-start token:", String(error).slice(0, 120));
    return createColdStartToken(videoId);
  }
}

// ---------------------------------------------------------------------------
// window.linerElectron web bridge
// ---------------------------------------------------------------------------

const APP_VERSION = "0.2.20 (website port by JayJoice)";

function noopAsync(): Promise<void> {
  return Promise.resolve();
}

function unsubscribeFn(): () => void {
  return () => {};
}

const webBridge: Record<string, unknown> = {
  platform: "web",
  getAppVersion: () => Promise.resolve(APP_VERSION),
  signRequest: async (payload: { method: string; path: string; body?: string; timestamp?: number }) => {
    return await signApiRequest(payload.method, payload.path, payload.body ?? null, payload.timestamp);
  },
  syncServerTime: async (_serverMs: number) => {
    serverTimeOffsetMs = _serverMs - Date.now();
    return {};
  },
  signCoverUrl: async (url: string) => url,

  // window controls — a browser has none (async: the renderer awaits these)
  isFullScreen: () => Promise.resolve(false),
  isMaximized: () => Promise.resolve(false),
  toggleFullScreen: noopAsync,
  toggleMaximize: noopAsync,
  minimize: noopAsync,
  dragStart: noopAsync,
  dragMove: noopAsync,
  dragEnd: noopAsync,
  isHyprland: false,
  close: noopAsync,

  // window state / lifecycle listeners
  onWindowStateChange: unsubscribeFn,
  onDeeplink: unsubscribeFn,
  notePresence: noopAsync,

  // overlay + touchbar (desktop-only surfaces)
  getOverlayInitialState: () => Promise.resolve(null),
  overlayReady: noopAsync,
  sendOverlayAction: noopAsync,
  onOverlayAction: unsubscribeFn,
  onOverlayState: unsubscribeFn,
  onOverlayVisibility: unsubscribeFn,
  closeOverlay: noopAsync,
  setOverlayAuthenticated: noopAsync,
  overlayUpdateState: noopAsync,
  updateOverlaySettings: noopAsync,
  pauseOverlayShortcuts: noopAsync,
  onTouchBarAction: unsubscribeFn,
  onTouchBarRequestSync: unsubscribeFn,
  touchbarUpdateState: noopAsync,

  // discord rich presence
  getDiscordStatus: () => Promise.resolve({ connected: false }),
  discordUpdateState: noopAsync,
  discordUpdateSettings: noopAsync,

  // updater / bundles
  bundleGetStatus: () => Promise.resolve(null),
  onBundleStamp: unsubscribeFn,

  // app icon
  setAppIcon: noopAsync,

  // caches (the browser's HTTP cache is opaque — report zeros)
  getCacheStats: () => Promise.resolve({ bytes: 0, count: 0 }),
  clearHttpCache: noopAsync,
  clearCoversCache: noopAsync,
  clearAudioCache: noopAsync,
  openCacheFolder: noopAsync,

  // local tracks / offline saved tracks (filesystem features)
  localTracksUsage: () => Promise.resolve({ bytes: 0, count: 0 }),
  savedTracksUsage: () => Promise.resolve({ bytes: 0, count: 0, freeBytes: null }),
  savedTracksUsageOf: (_ids: string[]) => Promise.resolve({ count: 0, bytes: 0 }),
  savedTracksList: () => Promise.resolve([]),
  savedTracksRemove: noopAsync,
  savedTracksRemoveAll: noopAsync,
  savedTracksOpenFolder: noopAsync,
  savedTracksGetLyrics: () => Promise.resolve(null),

  // diagnostics — the renderer falls back to browser-side probes
  diagnoseNetwork: undefined,
  probeNetwork: undefined,

  // YouTube PoToken minting (BotGuard, in-page via bgutils-js)
  mintPoToken: (videoId: string) => mintPoToken(videoId),

  // edge signing key: nothing to store in web
  setEdgeKey: noopAsync,
};

function installBridge(): void {
  if (typeof window === "undefined") return;
  Object.defineProperty(window, "linerElectron", {
    value: webBridge,
    configurable: false,
    writable: false,
  });
}

// ---------------------------------------------------------------------------
// fan sessions: guest + Discord sign-in
// ---------------------------------------------------------------------------

const SESSION_KEY = "liner_auth_session";

interface GuestResponse {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  user: unknown;
  recoveryToken?: string;
}

async function guestLogin(): Promise<void> {
  const res = await fetch("/api/auth/guest", { method: "POST" });
  if (!res.ok) throw new Error(`guest sign-in failed (${res.status})`);
  const data = (await res.json()) as GuestResponse;
  const session = {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    accessTokenExpiresAt: data.accessTokenExpiresAt,
    user: data.user,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.location.reload();
}

function discordLogin(): void {
  window.location.assign("/api/auth/discord/start");
}

/** Consumes the Discord OAuth fragment (#/auth/discord?at=…&rt=…&exp=…). */
function consumeDiscordFragment(): boolean {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash || "";
  if (!hash.startsWith("#/auth/discord")) return false;
  const params = new URLSearchParams(hash.slice("#/auth/discord".length));
  const at = params.get("at");
  const rt = params.get("rt");
  const exp = params.get("exp");
  const userB64 = params.get("user");
  if (!at || !rt || !exp) {
    console.warn("[liner-web] discord handoff failed:", params.get("error") ?? "missing tokens");
    history.replaceState(null, "", window.location.pathname + "#/");
    return true;
  }
  let user: unknown = null;
  try {
    if (userB64) user = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(userB64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
  } catch {
    user = null;
  }
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ accessToken: at, refreshToken: rt, accessTokenExpiresAt: exp, user }),
  );
  history.replaceState(null, "", window.location.pathname + "#/");
  window.location.reload();
  return true;
}

// ---------------------------------------------------------------------------
// login screen injection (guest + discord buttons)
// ---------------------------------------------------------------------------

function styleInjectedButton(btn: HTMLButtonElement, primary: boolean): void {
  btn.type = "button";
  btn.setAttribute("data-liner-web-fan", primary ? "guest" : "discord");
  const base: Partial<CSSStyleDeclaration> = primary
    ? {
        width: "100%",
        marginTop: "10px",
        padding: "12px 16px",
        borderRadius: "12px",
        border: "1px solid rgba(190,255,170,0.5)",
        background: "rgba(190,255,170,0.14)",
        color: "#d6ffbc",
        fontSize: "14px",
        fontWeight: "600",
        cursor: "pointer",
        textAlign: "center",
      }
    : {
        width: "100%",
        marginTop: "8px",
        padding: "12px 16px",
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,0.16)",
        background: "rgba(255,255,255,0.06)",
        color: "#e8e8ea",
        fontSize: "14px",
        fontWeight: "600",
        cursor: "pointer",
        textAlign: "center",
      };
  Object.assign(btn.style, base);
}

function findLoginFormRoot(): HTMLElement | null {
  // the login screen: look for the submit button by text (the beta routes it
  // at #/login; the text match is the real signal, so stay permissive)
  const hash = window.location.hash || "";
  if (hash.startsWith("#/overlay")) return null;
  const buttons = Array.from(document.querySelectorAll("button"));
  const submit = buttons.find((b) =>
    /^(sign in|log in|create account|join liner|sign up)$/i.test((b.textContent || "").trim()),
  );
  return submit ?? null;
}

function injectFanLoginButtons(): void {
  if (document.querySelector('[data-liner-web-fan="guest"]')) return;
  const buttons = Array.from(document.querySelectorAll("button"));
  const submit = buttons.find((b) =>
    /^(sign in|log in|create account|join liner|sign up)$/i.test((b.textContent || "").trim()),
  );
  if (!submit) return;

  // the beta's own OAuth buttons are desktop deeplink flows (they bounce off
  // tryliner.fun and can never complete in a browser): the Discord one is
  // rewired to the fan server's OAuth start, Google is hidden
  const google = buttons.find((b) => (b.textContent || "").trim() === "Google");
  if (google) google.style.display = "none";
  if (!document.body.dataset.discordRewired) {
    document.body.dataset.discordRewired = "1";
    document.addEventListener(
      "click",
      (event) => {
        const target = (event.target as HTMLElement | null)?.closest?.("button");
        if (!target || (target.textContent || "").trim() !== "Discord") return;
        event.preventDefault();
        event.stopPropagation();
        discordLogin();
      },
      true,
    );
  }

  // guest button styled like the native controls, placed right below the
  // submit button inside the form column
  const guest = document.createElement("button");
  guest.textContent = "Continue as guest";
  guest.type = "button";
  guest.setAttribute("data-liner-web-fan", "guest");
  guest.className = submit.className;
  guest.style.marginTop = "10px";
  guest.style.width = "100%";
  guest.addEventListener("click", () => {
    guest.disabled = true;
    guest.textContent = "Signing in…";
    guestLogin().catch(() => {
      guest.disabled = false;
      guest.textContent = "Continue as guest";
    });
  });
  const column = submit.closest("form") ?? submit.parentElement;
  column?.insertBefore(guest, submit.nextSibling);
}

function injectWebChromeOverrides(): void {
  if (document.getElementById("liner-web-shell-css")) return;
  const style = document.createElement("style");
  style.id = "liner-web-shell-css";
  // a browser has no window to minimize/maximize/close: hide the capsule
  style.textContent = '[data-window-controls="true"] { display: none !important; }';
  document.head.appendChild(style);
}

function watchLoginScreen(): void {
  const tryInject = () => {
    try {
      injectFanLoginButtons();
      injectWebChromeOverrides();
    } catch {
      /* keep observing */
    }
  };
  tryInject();
  const observer = new MutationObserver(() => tryInject());
  observer.observe(document.body, { childList: true, subtree: true });
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  // BotGuard's VM degrades to a useless "$"-prefixed response when it sees
  // automation flags — hide them (on the prototype, where the VM looks)
  // before anything else runs
  try {
    const navProto = Object.getPrototypeOf(navigator) as Record<string, unknown>;
    Object.defineProperty(navProto, "webdriver", { get: () => false, configurable: true });
    Object.defineProperty(navProto, "userAgent", {
      get: () =>
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      configurable: true,
    });
    Object.defineProperty(navProto, "platform", { get: () => "Linux x86_64", configurable: true });
    Object.defineProperty(navProto, "languages", { get: () => ["en-US", "en"], configurable: true });
    Object.defineProperty(navProto, "hardwareConcurrency", { get: () => 8, configurable: true });
  } catch {
    /* non-configurable */
  }
  try {
    (window as unknown as Record<string, unknown>).chrome = (window as unknown as Record<string, unknown>).chrome ?? { runtime: {} };
  } catch {
    /* ignore */
  }
  installWebFetchProxy();
  installBridge();
  if (!consumeDiscordFragment()) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", watchLoginScreen);
    } else {
      watchLoginScreen();
    }
  }
  // website-port debug hook (used during live verification)
  (window as unknown as Record<string, unknown>).__linerWebDebug = {
    inject: injectFanLoginButtons,
    rewrite: rewriteForWeb,
    mintProbe: async () => {
      try {
        const challenge = await getChallenge({
          requestKey: BOTGUARD_REQUEST_KEY,
          fetchFunction: (input, init) => fetch(input, init),
        });
        return {
          keys: Object.keys(challenge),
          scriptShape: JSON.stringify(challenge.interpreterJavascript)?.slice(0, 220),
          hasScript: Boolean(challenge.interpreterJavaScript),
          hasUrl: Boolean(challenge.interpreterUrl),
          globalName: challenge.globalName,
          programLen: challenge.program?.length ?? 0,
        };
      } catch (e) {
        return { error: String(e) };
      }
    },
    mintTest: async (videoId: string) => {
      try {
        const token = await mintPoToken(videoId || "BI9HQCzpDgQ");
        return { ok: true, len: token.length, head: token.slice(0, 24) };
      } catch (e) {
        return { ok: false, error: String(e), stack: (e as Error)?.stack?.slice(0, 400) };
      }
    },
    rawChallenge: async () => {
      const res = await fetch(
        "https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/Create",
        {
          method: "POST",
          headers: { "content-type": "application/json+protobuf", "x-goog-api-key": GOOG_API_KEY },
          body: JSON.stringify([BOTGUARD_REQUEST_KEY]),
        },
      );
      const data = (await res.json()) as unknown[];
      const parsed: unknown[] = [];
      if (data.length > 1 && typeof data[1] === "string") {
        const descrambled = descrambleChallenge(data[1] as string);
        try {
          parsed.push(...(JSON.parse(descrambled || "[]") as unknown[]));
        } catch {
          /* unparsable */
        }
      } else if (data.length > 0 && typeof data[0] === "object") {
        parsed.push(...((data[0] as unknown[]) || []));
      }
      const wrappedScript = parsed[2];
      const wrappedUrl = parsed[3];
      const scriptVal = Array.isArray(wrappedScript)
        ? wrappedScript.find((v) => v && typeof v === "string")
        : undefined;
      const urlVal = Array.isArray(wrappedUrl)
        ? wrappedUrl.find((v) => v && typeof v === "string")
        : undefined;
      return {
        status: res.status,
        topShapes: data.map((v) => (typeof v === "string" ? `str(${(v as string).length})` : typeof v)),
        globalName: parsed[5],
        hasProgram: Boolean(parsed[4]),
        hasScriptVal: Boolean(scriptVal),
        hasUrlVal: Boolean(urlVal),
        urlHead: typeof urlVal === "string" ? urlVal.slice(0, 80) : null,
      };
    },
  };
}
