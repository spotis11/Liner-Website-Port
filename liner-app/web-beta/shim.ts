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

// ---------------------------------------------------------------------------
// refresh backoff — staging answers 403 BETA_REQUIRED for upstream sessions
// that lack the beta Discord role ("Beta role in the Liner Discord server is
// required to sign in"). The app retries on every 401, which floods the
// network log with hundreds of doomed refreshes. After one BETA_REQUIRED we
// answer the retries locally (same 403 shape) for 10 minutes.
// ---------------------------------------------------------------------------

const REFRESH_BACKOFF_MS = 10 * 60_000;
let refreshBackoffUntil = 0;
let refreshBackoffLogged = false;

function isRefreshCall(url: string): boolean {
  return /\/v1\/auth\/refresh(\?|$)/.test(url);
}

function betaRequiredResponse(): Response {
  return new Response(JSON.stringify({ code: "BETA_REQUIRED" }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

function installWebFetchProxy(): void {
  if (typeof window === "undefined" || typeof window.fetch === "undefined") return;
  const originalFetch = window.fetch.bind(window);

  const withGuards = async (rawUrl: string, run: () => Promise<Response>): Promise<Response> => {
    // refresh backoff (BETA_REQUIRED flood)
    if (isRefreshCall(rawUrl)) {
      if (Date.now() < refreshBackoffUntil) {
        if (!refreshBackoffLogged) {
          refreshBackoffLogged = true;
          webLog("auth: BETA_REQUIRED backoff active — refresh retries answered locally for 10min");
        }
        return betaRequiredResponse();
      }
      const response = await run();
      if (response.status === 403) {
        try {
          const body = (await response.clone().json()) as { code?: string };
          if (body?.code === "BETA_REQUIRED") {
            refreshBackoffUntil = Date.now() + REFRESH_BACKOFF_MS;
            webLog("auth: upstream says BETA_REQUIRED (beta Discord role required) — backing off");
          }
        } catch {
          /* not a structured error */
        }
      }
      return response;
    }
    // lyrics sniffer (fan translate + themes)
    const response = await run();
    const trackId = sniffLyricsSse(rawUrl);
    if (trackId && response.ok && (response.headers.get("content-type") ?? "").includes("event-stream")) {
      void noteLyricsResponse(trackId, response);
    }
    return response;
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (typeof input === "string" || input instanceof URL) {
      const raw = input.toString();
      const rewritten = rewriteForWeb(raw, init?.method);
      tapVisitorData(init);
      if (rewritten === raw) return withGuards(raw, () => originalFetch(input as RequestInfo, init));
      return withGuards(raw, () => originalFetch(rewritten, init));
    }
    const rewritten = rewriteForWeb(input.url, input.method);
    if (rewritten === input.url) return withGuards(input.url, () => originalFetch(input, init));
    return withGuards(input.url, () => originalFetch(new Request(rewritten, input), init));
  };
}

// ---------------------------------------------------------------------------
// audio element proxy (fetch() doesn't cover <audio>)
//
// The resolver validates stream URLs via /api/media probes (same-origin), but
// then attaches the RAW googlevideo URL to the <audio> element — those URLs
// are IP-locked to the server that minted them and send no CORS headers, so
// in a browser the audio element 403s / CORS-fails (Electron doesn't care).
// Hook the src setter + setAttribute and route media-element loads through
// the same /api/media proxy the probes and downloads already use.
// ---------------------------------------------------------------------------

const MEDIA_PROXY_PREFIX = "/api/media?u=";

function mediaHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function isMediaElementUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || !/^https?:\/\//.test(raw)) return false;
  const host = mediaHostname(raw);
  return hostMatches(host, "googlevideo.com") || hostMatches(host, "sndcdn.com");
}

function rewriteMediaSrc(value: unknown): unknown {
  if (isMediaElementUrl(value)) return MEDIA_PROXY_PREFIX + encodeURIComponent(value);
  return value;
}

function installMediaProxy(): void {
  if (typeof window === "undefined") return;
  try {
    const srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
    if (srcDesc?.set) {
      Object.defineProperty(HTMLMediaElement.prototype, "src", {
        get: srcDesc.get,
        set(value) {
          srcDesc.set.call(this, rewriteMediaSrc(value) as string);
        },
        configurable: true,
      });
    }
    const origSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (
      this: Element,
      name: string,
      value: string,
    ) {
      if (name.toLowerCase() === "src" && this instanceof HTMLMediaElement) {
        const rewritten = rewriteMediaSrc(value);
        if (rewritten !== value) {
          return origSetAttribute.call(this, name, rewritten as string);
        }
      }
      return origSetAttribute.call(this, name, value);
    };
  } catch {
    /* prototype hooks are best-effort */
  }
}

// ---------------------------------------------------------------------------
// XHR proxy — the fetch interceptor doesn't cover XMLHttpRequest
//
// The renderer has at least one XHR JSON loader; if it ever loads media or
// upstream JSON the way fetch does, those requests must ride the same
// same-origin proxies or they hit CORS / IP-locks in the browser.
// ---------------------------------------------------------------------------

function installXhrProxy(): void {
  if (typeof window === "undefined") return;
  try {
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      let target = url;
      if (typeof target === "string" || target instanceof URL) {
        const rewritten = rewriteForWeb(target.toString(), method);
        if (rewritten !== target.toString()) target = rewritten;
      }
      return (origOpen as unknown as (...args: unknown[]) => XMLHttpRequest).apply(
        this,
        [method, target, ...rest],
      ) as XMLHttpRequest;
    };
  } catch {
    /* prototype hooks are best-effort */
  }
}

// ---------------------------------------------------------------------------
// worker proxy — code inside blob: workers never sees the page's fetch patch
//
// Worker-scoped fetches to googlevideo/sndcdn would 403/CORS-fail in a
// browser (Electron doesn't care). Wrap the Worker constructor: for blob
// workers, prepend a tiny self-contained proxy before the worker's own code.
// ---------------------------------------------------------------------------

const WORKER_PROXY_SOURCE = `
;(function(){
  var Bypass=["blob:","data:","about:","chrome:","resource:"];
  var MediaHosts=["googlevideo.com","sndcdn.com","ytimg.com","googleusercontent.com","tryliner.fun","tryliner.com","r2.dev","r2.cloudflarestorage.com","amazonaws.com","pinimg.com","clstorage.net","soundcloud.com"];
  function matches(h,s){return h===s||h.endsWith("."+s);}
  function rewrite(raw,method){
    if(!raw||typeof raw!=="string")return raw;
    for(var i=0;i<Bypass.length;i++){if(raw.indexOf(Bypass[i])===0)return raw;}
    if(raw.charAt(0)==="/")return raw;
    var url;try{url=new URL(raw,self.location.origin);}catch(e){return raw;}
    if(url.origin===self.location.origin)return raw;
    var h=url.hostname;
    if(h==="youtubei.googleapis.com"&&url.pathname.indexOf("/youtubei")===0){
      return "/api/yt"+url.pathname.slice("/youtubei".length)+url.search;}
    if(matches(h,"youtube.com")&&(url.pathname.indexOf("/youtubei/")===0||url.pathname==="/youtubei")){
      return "/api/yt"+url.pathname.slice("/youtubei".length)+url.search;}
    if(matches(h,"youtube.com")||matches(h,"googlevideo.com")){
      var isManifest=url.pathname==="/api/manifest"||url.pathname.indexOf("/api/manifest/")===0;
      var isVp=url.pathname==="/videoplayback";
      if(isManifest||(isVp&&(method||"GET").toUpperCase()==="POST")){
        return "/api/yt/sabr?u="+encodeURIComponent(url.toString());}
      if(isVp){return "/api/media?u="+encodeURIComponent(url.toString());}
    }
    if(h==="api-v2.soundcloud.com"){return "/api/sc"+url.pathname+url.search;}
    for(var j=0;j<MediaHosts.length;j++){
      if(matches(h,MediaHosts[j])){return "/api/media?u="+encodeURIComponent(url.toString());}}
    return raw;
  }
  try{
    var of=self.fetch?self.fetch.bind(self):null;
    if(of){self.fetch=function(input,init){
      var raw=typeof input==="string"?input:(input&&input.url)||null;
      if(raw){var r=rewrite(raw,init&&init.method);
        if(r!==raw){if(typeof input==="string")return of(r,init);
          return of(new Request(r,input));}}
      return of(input,init);};}
  }catch(e){}
  try{
    var oo=XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open=function(m,u){
      var rest=Array.prototype.slice.call(arguments,2);
      if(typeof u==="string"){var r=rewrite(u,m);if(r!==u)u=r;}
      return oo.apply(this,[m,u].concat(rest));};
  }catch(e){}
})();
`;

function installWorkerProxy(): void {
  if (typeof window === "undefined" || typeof Worker === "undefined") return;
  const OriginalWorker = Worker;
  function PatchedWorker(this: Worker, scriptURL: string | URL, ...rest: unknown[]) {
    const raw = typeof scriptURL === "string" ? scriptURL : scriptURL.toString();
    // only blob: workers can be rewritten in place; real same-origin files
    // already run behind the page's fetch patch for their OWN requests — no,
    // they don't: a worker executes its own global scope. But cross-origin
    // and same-origin file workers can't be fetched+re-blobbed safely
    // (CORS on the script itself), so blob rewriting is the safe subset.
    if (raw.startsWith("blob:")) {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", raw, false); // sync XHR is allowed inside the page for blob:
        xhr.send(null);
        if (xhr.status === 200 && xhr.responseText && !xhr.responseText.includes("__linerWorkerProxy")) {
          const patched = WORKER_PROXY_SOURCE + "\n;window.__linerWorkerProxy=1;\n" + xhr.responseText;
          const blob = new Blob([patched], { type: "text/javascript" });
          scriptURL = URL.createObjectURL(blob);
        }
      } catch {
        /* fall through with the original URL */
      }
    }
    const ctorArgs: unknown[] = [scriptURL, ...rest];
    return new (OriginalWorker as unknown as new (...args: unknown[]) => Worker)(...ctorArgs);
  }
  try {
    PatchedWorker.prototype = OriginalWorker.prototype;
    Object.defineProperty(window, "Worker", {
      value: PatchedWorker,
      configurable: true,
      writable: true,
    });
  } catch {
    /* keep the original Worker */
  }
}

// ---------------------------------------------------------------------------
// fan lyrics registry — sniffed from the relay's SSE responses
//
// The beta fetches lyrics from /v1/tracks/:id/lyrics (an SSE stream of
// provider candidates). The fan features (AI translate + lyric themes) read
// the same body out of the fetch proxy and register it per track.
// ---------------------------------------------------------------------------

export interface FanShimLyrics {
  trackId: string;
  body: string;
  format: string;
  provider: string;
}

function sniffLyricsSse(url: string): string | null {
  const m = url.match(/\/v1\/tracks\/([^/?]+)\/lyrics/);
  return m ? decodeURIComponent(m[1]) : null;
}

const fanLyricsRegistry = new Map<string, FanShimLyrics>();

async function noteLyricsResponse(trackId: string, response: Response): Promise<void> {
  try {
    const body = await response.clone().text();
    if (!body.includes("candidate")) return;
    let provider = "unknown";
    let format = "plain";
    for (const chunk of body.split("\n\n")) {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        const payload = JSON.parse(line.slice(6)) as {
          type?: string;
          status?: string;
          candidate?: { provider?: string; lyrics?: { format?: string } };
        };
        if (payload.type === "provider" && payload.status === "found" && payload.candidate) {
          provider = payload.candidate.provider ?? provider;
          format = payload.candidate.lyrics?.format ?? format;
          break;
        }
      } catch {
        /* malformed event */
      }
    }
    fanLyricsRegistry.set(trackId, { trackId, body, format, provider });
    (window as unknown as { __linerFanLyricsRaw?: Map<string, FanShimLyrics> }).__linerFanLyricsRaw =
      fanLyricsRegistry;
  } catch {
    /* sniffing is best-effort */
  }
}

// ---------------------------------------------------------------------------
// Discord Rich Presence — direct gateway client (fan feature)
//
// The classic web port connected to Discord's gateway with a USER-PROVIDED
// token kept in localStorage `liner_discord_rpc_token` and broadcast
// PRESENCE_UPDATE (op 3) frames. The beta pushes full playback state into
// bridge.discordUpdateState — so the shim owns the whole feature: connect on
// demand, build the Listening activity, refresh it on heartbeats.
// ---------------------------------------------------------------------------

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const DISCORD_APP_ID = "1561339119617974362"; // Liner's official application id
const DISCORD_TOKEN_KEY = "liner_discord_rpc_token";
const DISCORD_SETTINGS_KEY = "liner_web_discord_settings";
const DISCORD_ASSET_KEY = "liner_web_discord_assets";

interface DiscordSettings {
  enabled: boolean;
  statusDisplayType: "artist" | "title" | "artist_title" | "title_artist" | "app";
  showArtwork: boolean;
  showTime: boolean;
  showPaused: boolean;
}

const DEFAULT_DISCORD_SETTINGS: DiscordSettings = {
  enabled: true,
  statusDisplayType: "artist",
  showArtwork: true,
  showTime: true,
  showPaused: true,
};

interface DiscordActivity {
  name: string;
  type: number;
  details?: string;
  state?: string;
  timestamps?: { start: number; end: number };
  assets?: { large_image?: string; large_text?: string; small_image?: string; small_text?: string };
}

interface DiscordRpcState {
  status: string;
  track: { id: string; title: string; artist: string; album?: string; coverUrl?: string; durationMs: number } | null;
  positionMs: number;
  durationMs: number;
  artistImageUrl?: string;
}

interface GatewayFrame {
  op: number;
  d?: Record<string, unknown> | null;
  t?: string;
  s?: number;
}

let discordWs: WebSocket | null = null;
let discordHeartbeat: ReturnType<typeof setInterval> | null = null;
let discordLastSeq: number | null = null;
let discordToken: string | null = null;
let discordIsBot = false;
let discordUsername: string | null = null;
let discordConnecting = false;
let discordError: string | null = null;
let discordLatest: DiscordRpcState | null = null;
let discordLatestAt = 0;
let discordLastFingerprint = "";
let discordFlushTimer: ReturnType<typeof setTimeout> | null = null;
const discordAssetCache = new Map<string, string>();

function readDiscordSettings(): DiscordSettings {
  try {
    const raw = localStorage.getItem(DISCORD_SETTINGS_KEY);
    if (raw) return { ...DEFAULT_DISCORD_SETTINGS, ...(JSON.parse(raw) as Partial<DiscordSettings>) };
  } catch {
    /* defaults */
  }
  return DEFAULT_DISCORD_SETTINGS;
}

function sanitizeDiscordText(value: string | undefined): string {
  return (value ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 120);
}

function sendDiscordFrame(frame: GatewayFrame): void {
  if (discordWs && discordWs.readyState === WebSocket.OPEN) {
    discordWs.send(JSON.stringify(frame));
  }
}

function discordConnectionStatus(): {
  connected: boolean;
  username?: string;
  connecting?: boolean;
  error?: string | null;
} {
  return {
    connected: Boolean(discordWs && discordWs.readyState === WebSocket.OPEN && discordUsername),
    username: discordUsername ?? undefined,
    connecting: discordConnecting,
    error: discordError,
  };
}

function disconnectDiscord(): void {
  if (discordHeartbeat) clearInterval(discordHeartbeat);
  discordHeartbeat = null;
  discordWs?.close(1000);
  discordWs = null;
  discordUsername = null;
  discordLastSeq = null;
  discordLastFingerprint = "";
}

function connectDiscord(token: string): void {
  disconnectDiscord();
  discordToken = token;
  // bot tokens carry the "Bot " prefix; plain tokens are user tokens —
  // the artwork resolution differs per kind (see resolveDiscordArtwork)
  discordIsBot = token.startsWith("Bot ");
  discordConnecting = true;
  discordError = null;
  webLog("discord rpc: connecting to gateway");
  const ws = new WebSocket(GATEWAY_URL);
  discordWs = ws;
  ws.onopen = () => webLog("discord rpc: gateway open");
  ws.onmessage = (event) => {
    try {
      const frame = JSON.parse(String(event.data)) as GatewayFrame;
      if (frame.s) discordLastSeq = frame.s;
      if (frame.op === 10) {
        const interval = Number((frame.d as { heartbeat_interval?: number })?.heartbeat_interval ?? 41250);
        if (discordHeartbeat) clearInterval(discordHeartbeat);
        discordHeartbeat = setInterval(() => {
          sendDiscordFrame({ op: 1, d: discordLastSeq });
          // Discord expires presences — refresh the activity on every beat
          flushDiscordPresence(true);
        }, Math.max(5000, interval - 1000));
        sendDiscordFrame({
          op: 2,
          d: {
            token,
            intents: 0,
            properties: { os: "Windows", browser: "Liner Web", device: "Liner Web" },
          },
        });
      } else if (frame.t === "READY") {
        const user = (frame.d as { user?: { username?: string; global_name?: string } })?.user;
        discordUsername = user?.global_name || user?.username || null;
        discordConnecting = false;
        webLog("discord rpc: ready as", discordUsername ?? "?");
        flushDiscordPresence(true);
      } else if (frame.op === 7 || frame.op === 9) {
        // reconnect / invalid session — re-identify once
        setTimeout(() => {
          if (discordToken) connectDiscord(discordToken);
        }, 1500);
      }
    } catch {
      /* malformed frame */
    }
  };
  ws.onerror = () => {
    discordError = "Gateway connection failed";
    discordConnecting = false;
  };
  ws.onclose = () => {
    discordConnecting = false;
    if (discordHeartbeat) clearInterval(discordHeartbeat);
    discordHeartbeat = null;
    if (discordWs === ws) discordWs = null;
  };
}

/** Build the Listening activity — port of the classic buildPresenceActivity. */
function buildDiscordActivity(state: DiscordRpcState, settings: DiscordSettings, now: number): DiscordActivity | null {
  if (!settings.enabled) return null;
  if (!state.track || state.status === "idle" || state.status === "error") return null;
  const isPlaying = state.status === "playing";
  const isPaused = state.status === "paused";
  if (isPaused && !settings.showPaused) return null;
  if (!isPlaying && !isPaused) return null;

  const title = sanitizeDiscordText(state.track.title) || "Unknown Title";
  const artist = sanitizeDiscordText(state.track.artist) || "Unknown Artist";
  const dur = Math.max(0, state.durationMs || state.track.durationMs || 0);

  let name = "Liner";
  let details = title;
  let stateText = isPaused ? `${artist} (Paused)` : artist;
  switch (settings.statusDisplayType) {
    case "title":
      name = title;
      details = isPaused ? `${title} (Paused)` : title;
      stateText = artist;
      break;
    case "artist_title":
      name = `${artist} - ${title}`;
      details = title;
      stateText = isPaused ? `${artist} - ${title} (Paused)` : `${artist} - ${title}`;
      break;
    case "title_artist":
      name = `${title} - ${artist}`;
      details = isPaused ? `${title} - ${artist} (Paused)` : `${title} - ${artist}`;
      stateText = artist;
      break;
    case "artist":
    default:
      break;
  }

  const activity: DiscordActivity = { name, type: 2, details, state: stateText };

  if (isPlaying && settings.showTime && dur > 0) {
    const elapsed = Math.max(0, now - (discordLatestAt || now));
    const currentPos = Math.min(dur, Math.max(0, (state.positionMs || 0) + elapsed));
    activity.timestamps = { start: now - currentPos, end: now - currentPos + dur };
  }

  const cover = state.track.coverUrl;
  if (settings.showArtwork && cover && /^https?:\/\//.test(cover)) {
    activity.assets = {
      large_image: cover,
      large_text: sanitizeDiscordText(state.track.album || title) || "Liner",
    };
  }
  return activity;
}

/** Register external artwork so user-token presences can reference it. */
async function resolveDiscordArtwork(url: string): Promise<string | null> {
  if (discordAssetCache.has(url)) return discordAssetCache.get(url)!;
  if (!discordToken) return null;
  try {
    if (discordIsBot) {
      const res = await fetch("/api/discord-asset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: discordToken, appId: DISCORD_APP_ID, url, key: "cover" }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { asset_id?: string };
      if (!data.asset_id) return null;
      discordAssetCache.set(url, data.asset_id);
      return data.asset_id;
    }
    const res = await fetch(
      `https://discord.com/api/v10/applications/${DISCORD_APP_ID}/external-assets`,
      {
        method: "POST",
        headers: { authorization: discordToken, "content-type": "application/json" },
        body: JSON.stringify({ urls: [url] }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { assets?: { external_asset_path?: string }[] };
    const path = data.assets?.[0]?.external_asset_path;
    if (!path) return null;
    discordAssetCache.set(url, path);
    return path;
  } catch {
    return null;
  }
}

let discordArtworkBusy = false;

async function flushDiscordPresence(force = false): Promise<void> {
  const settings = readDiscordSettings();
  const state = discordLatest;
  const fingerprint = state?.track
    ? [state.status, state.track.id, state.track.title, state.track.artist, state.track.coverUrl ?? ""].join("\u0000")
    : "idle";
  const activity = buildDiscordActivity(
    state ?? { status: "idle", track: null, positionMs: 0, durationMs: 0 },
    settings,
    Date.now(),
  );

  // PRIMARY — arRPC: the local bridge accepts raw https artwork urls
  // (the running Discord client resolves them), no asset registration needed.
  if (arrpcStatus()) {
    if (!force && fingerprint === discordLastFingerprint) return;
    discordLastFingerprint = fingerprint;
    if (activity?.assets?.large_image) {
      activity.assets.large_image = state?.track.coverUrl ?? activity.assets.large_image;
    }
    sendArrpcActivity(activity);
    // gateway may also be live (stored token) — keep it in sync below
    if (!discordWs || discordWs.readyState !== WebSocket.OPEN) return;
  }

  // FALLBACK — direct gateway: external artwork must be registered per token
  if (!discordWs || discordWs.readyState !== WebSocket.OPEN) return;
  if (!force && fingerprint === discordLastFingerprint) return;

  // artwork: swap the raw url for a registered asset key before sending
  if (activity?.assets?.large_image && /^https?:\/\//.test(activity.assets.large_image)) {
    const raw = activity.assets.large_image;
    const cached = discordAssetCache.get(raw);
    if (cached) {
      activity.assets.large_image = cached;
    } else if (!discordArtworkBusy) {
      discordArtworkBusy = true;
      void resolveDiscordArtwork(raw).then((key) => {
        discordArtworkBusy = false;
        if (key) {
          discordLastFingerprint = ""; // artwork resolved — send the upgrade
          flushDiscordPresence(true);
        }
      });
    }
    if (!cached && activity.assets.large_image === raw) {
      delete activity.assets.large_image; // don't ship a raw external url
    }
  }

  discordLastFingerprint = fingerprint;
  sendDiscordFrame({
    op: 3,
    d: {
      since: Date.now(),
      activities: activity ? [activity] : [],
      afk: false,
      status: "online",
    },
  });
}

function scheduleDiscordPresence(state: DiscordRpcState): void {
  discordLatest = state;
  discordLatestAt = Date.now();
  if (discordFlushTimer) clearTimeout(discordFlushTimer);
  discordFlushTimer = setTimeout(() => void flushDiscordPresence(), 900);
}

// ---------------------------------------------------------------------------
// arRPC — the unofficial local rich-presence bridge (primary Discord path)
//
// The desktop app talks to arRPC (OpenAsar's bridge, ws://127.0.0.1:1337)
// when it runs next to the user's Discord client; the beta's own settings UI
// even has the "Connected via arRPC" status string. In the web shell the shim
// owns that connection: presence frames go to the LOCAL arRPC server, which
// forwards them to the running Discord client. No token, fully unofficial.
// The direct-gateway client below stays as a silent fallback for a stored
// token (the classic web port's method).
// ---------------------------------------------------------------------------

const ARRPC_URLS = ["ws://127.0.0.1:1337", "ws://localhost:1337"];
let arrpcWs: WebSocket | null = null;
let arrpcSocketId = `liner-web-${Math.random().toString(36).slice(2, 10)}`;
let arrpcAlive = false;
let arrpcLatestActivity: DiscordActivity | null = null;
let arrpcProbing = false;

function arrpcStatus(): boolean {
  return arrpcAlive && arrpcWs?.readyState === WebSocket.OPEN;
}

function sendArrpcActivity(activity: DiscordActivity | null): void {
  arrpcLatestActivity = activity;
  if (!arrpcStatus()) return;
  try {
    arrpcWs!.send(JSON.stringify({ socketId: arrpcSocketId, activity }));
  } catch {
    /* socket died mid-send — the probe loop reconnects */
  }
}

function openArrpc(): void {
  if (arrpcProbing || arrpcStatus()) return;
  arrpcProbing = true;
  const tryUrl = (idx: number): void => {
    if (idx >= ARRPC_URLS.length) {
      arrpcProbing = false;
      return;
    }
    let settled = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(ARRPC_URLS[idx]);
    } catch {
      tryUrl(idx + 1);
      return;
    }
    const giveUp = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch { /* already closed */ }
        tryUrl(idx + 1);
      }
    }, 2500);
    ws.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(giveUp);
      arrpcProbing = false;
      arrpcWs = ws;
      arrpcAlive = true;
      webLog("discord rpc: connected via arRPC (localhost:1337)");
      // (re)announce the current presence through the unofficial bridge
      if (arrpcLatestActivity !== null) sendArrpcActivity(arrpcLatestActivity);
      else void flushDiscordPresence(true);
    };
    ws.onclose = () => {
      if (arrpcWs === ws) {
        arrpcWs = null;
        arrpcAlive = false;
        webLog("discord rpc: arRPC closed");
      }
      if (!settled) {
        settled = true;
        clearTimeout(giveUp);
        tryUrl(idx + 1);
      }
    };
    ws.onerror = () => { /* handled by onclose */ };
  };
  tryUrl(0);
}

function installDiscordRpc(): void {
  // PRIMARY: the unofficial local bridge — probe now and re-probe every 45s
  // so plugging arRPC in later Just Works. Silent: no UI, no token.
  openArrpc();
  setInterval(() => {
    if (!arrpcAlive && !arrpcProbing) openArrpc();
  }, 45_000);
  // FALLBACK (silent): the classic direct-gateway method with a device-local
  // token, only when arRPC is not reachable and the user stored a token.
  const saved = lsGetCompat(DISCORD_TOKEN_KEY);
  if (saved && !arrpcAlive) connectDiscord(saved);
  (window as unknown as FanShimWindow).__linerFanDiscord = {
    connect: (token: string) => {
      lsSetCompat(DISCORD_TOKEN_KEY, token);
      if (!arrpcAlive) connectDiscord(token);
    },
    disconnect: () => {
      lsSetCompat(DISCORD_TOKEN_KEY, "");
      disconnectDiscord();
      void flushDiscordPresence(true);
    },
    status: () => {
      if (arrpcStatus()) {
        return { connected: true, viaArrpc: true as const };
      }
      return discordConnectionStatus();
    },
  };
}

// localStorage helpers that never throw (the gateway client runs at boot)
function lsGetCompat(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSetCompat(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

interface FanShimWindow extends Window {
  __linerFanDiscord?: {
    connect: (token: string) => void;
    disconnect: () => void;
    status: () => { connected: boolean; username?: string; connecting?: boolean; error?: string | null };
  };
  __linerFanState?: DiscordRpcState & { updatedAt: number };
}


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

  // presence: the app reports its own playback state here too — mirror it
  // into the fan state registry for the AI-translate / lyric-themes layer
  notePresence: (payload?: unknown) => {
    try {
      const state = payload as { status?: string; track?: DiscordRpcState["track"]; positionMs?: number; durationMs?: number } | undefined;
      if (state?.track?.id) {
        (window as unknown as FanShimWindow).__linerFanState = {
          status: state.status ?? "playing",
          track: state.track,
          positionMs: state.positionMs ?? 0,
          durationMs: state.durationMs ?? state.track.durationMs ?? 0,
          updatedAt: Date.now(),
        };
        window.dispatchEvent(new CustomEvent("liner-web-state"));
      }
    } catch {
      /* fan state is best-effort */
    }
    return Promise.resolve();
  },

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

  // discord rich presence — REAL: the unofficial arRPC bridge is primary
  // (the beta's own settings UI shows "Connected via arRPC"), the direct
  // gateway on a device-local token stays as the silent fallback
  getDiscordStatus: () => {
    if (arrpcStatus()) {
      return Promise.resolve({ connected: true, viaArrpc: true });
    }
    const s = discordConnectionStatus();
    return Promise.resolve({
      connected: s.connected,
      username: s.username,
      viaArrpc: false,
      connecting: s.connecting,
      error: s.error,
    });
  },
  discordUpdateState: (state: DiscordRpcState) => {
    try {
      (window as unknown as FanShimWindow).__linerFanState = {
        status: state.status,
        track: state.track,
        positionMs: state.positionMs,
        durationMs: state.durationMs,
        updatedAt: Date.now(),
      };
      window.dispatchEvent(new CustomEvent("liner-web-state"));
    } catch {
      /* fan state is best-effort */
    }
    scheduleDiscordPresence(state);
    return Promise.resolve();
  },
  discordUpdateSettings: (settings: Partial<DiscordSettings>) => {
    lsSetCompat(DISCORD_SETTINGS_KEY, JSON.stringify({ ...readDiscordSettings(), ...settings }));
    void flushDiscordPresence(true);
    return Promise.resolve();
  },

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
  // a browser has no window to minimize/maximize/close: hide every window-
  // controls capsule. The fullscreen player's variant carries NO
  // data-window-controls attribute — its container is styled with the
  // arbitrary variant `[&>button:first-child]`, a stable literal we can
  // match with an attribute-contains selector (verified live 2026-11-25;
  // the lyrics-offset pill uses `[&>:first-child>button]` — NOT matched).
  style.textContent = [
    "[data-window-controls], .window-controls-pill { display: none !important; }",
    "[class*='[&>button:first-child'] { display: none !important; }",
  ].join("\n");
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
  installMediaProxy();
  installXhrProxy();
  installWorkerProxy();
  installBridge();
  installDiscordRpc();
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
    fanState: () => (window as unknown as FanShimWindow).__linerFanState ?? null,
    fanLyricsRaw: () => Array.from(fanLyricsRegistry.keys()),
    discord: () => ({ ...discordConnectionStatus(), latest: discordLatest?.track?.title ?? null }),
    mintTest: mintPoToken,
  };
}
