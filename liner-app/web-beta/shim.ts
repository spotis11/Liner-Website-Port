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
    return originalFetch(new Request(rewritten, input), init);
  };
}

// ---------------------------------------------------------------------------
// website-port logging (boot epoch disambiguates reloads in the console)
// ---------------------------------------------------------------------------

const BOOT_EPOCH = Math.random().toString(36).slice(2, 8);

const LOG_BUFFER: string[] = [];
function webLog(...parts: unknown[]): void {
  const line = `[${BOOT_EPOCH}] ${parts.map((p) => String(p)).join(" ")}`;
  LOG_BUFFER.push(line);
  if (LOG_BUFFER.length > 120) LOG_BUFFER.shift();
  console.info(line);
}

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

// PoToken minting delegates to the fan server's /api/po-token (JSDOM +
// bgutils in Node — the same flow the 0.2.12 port has used in production
// for months). The in-page BotGuard approach was retired: the VM refuses to
// hand out its minter under headless/automation environments.
const POT_TOKEN_TTL_MS = 5.5 * 3600 * 1000;

function potCacheKey(binding: string): string {
  return `liner-web-pot-${binding}`;
}

function readCachedPot(binding: string): string | null {
  try {
    const raw = localStorage.getItem(potCacheKey(binding));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token: string; exp: number };
    if (parsed.token && Date.now() < parsed.exp) return parsed.token;
    localStorage.removeItem(potCacheKey(binding));
  } catch {
    /* fall through */
  }
  return null;
}

function writeCachedPot(binding: string, token: string): void {
  try {
    localStorage.setItem(
      potCacheKey(binding),
      JSON.stringify({ token, exp: Date.now() + POT_TOKEN_TTL_MS }),
    );
  } catch {
    /* storage full — tokens just won't be shared */
  }
}

/**
 * mints (or reuses) a PoToken. `videoId` is the binding the caller wants:
 * the app asks per video; the cache key is the binding actually used so
 * visitor-bound and video-bound tokens never collide.
 */
async function mintPoToken(videoId: string): Promise<string> {
  // cache key = the actual binding (video or visitor) so the two never
  // collide; the mint itself is content-bound to the 11-char videoId, with
  // the tapped visitorData forwarded as the separate param the route knows
  const binding = tappedVisitorData || videoId;
  const cached = readCachedPot(binding);
  if (cached) return cached;
  const id = /^[a-zA-Z0-9_-]{11}$/.test(videoId) ? videoId : "BI9HQCzpDgQ";
  const params = new URLSearchParams({ videoId: id });
  if (tappedVisitorData) params.set("visitorData", tappedVisitorData);
  const res = await fetch(`/api/po-token?${params.toString()}`);
  if (!res.ok) throw new Error(`po-token mint failed (${res.status})`);
  const data = (await res.json()) as { poToken?: string };
  if (!data.poToken) throw new Error("po-token mint returned no token");
  writeCachedPot(binding, data.poToken);
  return data.poToken;
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

  // YouTube PoToken minting (delegated to the fan server's /api/po-token)
  mintPoToken: async (videoId: string) => {
    webLog("bridge mintPoToken called, arg:", JSON.stringify(videoId).slice(0, 60));
    try {
      const token = await mintPoToken(videoId);
      webLog("bridge mint ok, len", String(token.length));
      return token;
    } catch (error) {
      webLog("bridge mint failed:", String(error).slice(0, 100));
      throw error;
    }
  },

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
// ban wall (fan feature)
//
// The 0.2.12 web port enforced website bans in the SPA (BanGate); the beta
// renderer is upstream's and has no such client, so the shim owns the wall
// now: it probes /api/moderation/check on boot (and whenever the stored
// session changes) and replaces the whole app with the branded banned
// screen when the server says this account or network is blocked.
// ---------------------------------------------------------------------------

interface BanCheckResult {
  banned: boolean;
  username?: string | null;
  type?: string | null;
  reason?: string | null;
  expiresAt?: string | null;
}

let banWallArmed = false;

function renderBannedScreen(result: BanCheckResult): void {
  if (document.getElementById("liner-banned-wall")) return;
  document.title = "Account suspended — Liner";
  const wall = document.createElement("div");
  wall.id = "liner-banned-wall";
  wall.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#0a0a0b;color:#e8e8ea;font-family:Inter,system-ui,sans-serif;overflow:auto;";
  const until = result.expiresAt
    ? new Date(result.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : null;
  wall.innerHTML = `
    <div style="max-width:420px;padding:40px 28px;text-align:center;">
      <div style="font-size:44px;font-weight:800;letter-spacing:-0.03em;color:#fff;">Liner</div>
      <div style="margin-top:18px;font-size:15px;color:#ff6b6b;font-weight:700;letter-spacing:0.02em;">
        THIS ACCOUNT IS ${result.type === "ip" ? "IP " : ""}BANNED
      </div>
      <div style="margin-top:12px;font-size:13.5px;line-height:1.6;color:#a1a1aa;">
        ${result.reason ? `Reason: ${result.reason}<br/>` : ""}
        ${until ? `Until ${until}.` : "This ban is permanent."}
      </div>
      <div style="margin-top:26px;font-size:12px;color:#52525b;">
        If you believe this is a mistake, contact the website owner.
      </div>
    </div>`;
  document.body.innerHTML = "";
  document.body.style.cssText = "margin:0;background:#0a0a0b;";
  document.body.appendChild(wall);
}

async function probeBanWall(): Promise<void> {
  try {
    let username: string | undefined;
    let accessToken: string | undefined;
    try {
      const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null") as
        | { accessToken?: string; user?: { username?: string } }
        | null;
      username = session?.user?.username || undefined;
      accessToken = session?.accessToken || undefined;
    } catch {
      /* no session — the network check still applies */
    }
    const res = await fetch("/api/moderation/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, accessToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return;
    const data = (await res.json()) as BanCheckResult;
    if (data?.banned) {
      webLog("ban wall: blocked", data.type ?? "");
      renderBannedScreen(data);
      return;
    }
    // re-probe when the session changes (sign-in as a different account)
    if (!banWallArmed) {
      banWallArmed = true;
      window.addEventListener("storage", (event) => {
        if (event.key === SESSION_KEY) void probeBanWall();
      });
      window.addEventListener("auth:changed", () => void probeBanWall());
    }
  } catch {
    /* moderation probe is best-effort — never block the app on it */
  }
}

function installBanWall(): void {
  void probeBanWall();
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  // BotGuard-era fingerprint patches (harmless, and the interpreter eval the
  // shim no longer performs leaves nothing that reads them — kept because the
  // navigator.userAgent override also normalizes headless quirks for misc
  // upstreams)
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
  console.info(`[liner-web@${BOOT_EPOCH}] boot build=${document.querySelector('script[src*=shim]')?.getAttribute("src") ?? "?"}`);
  installWebFetchProxy();
  installBridge();
  installBanWall();
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
    logs: () => [...LOG_BUFFER],
  };
}
