// Liner web port: the desktop build relies on the Electron main process to
// open CORS on every upstream response (electron/cors.ts). A plain browser
// cannot do that, so cross-origin traffic is transparently rerouted through
// same-origin proxy routes served by the web shell:
//
//   /api/yt/...        -> https://music.youtube.com/youtubei/...
//   /api/yt/www/...    -> https://www.youtube.com/youtubei/... (TV profiles)
//   /api/yt/sabr?u=... -> SABR UMP streaming POSTs (/api/manifest/... on
//                         youtube.com / googlevideo.com), streamed 1:1
//   /api/sc/...        -> https://api-v2.soundcloud.com/...
//   /api/fetch?u=...   -> generic JSON/text/form upstreams (oauth, imports, discovery)
//   /api/media?u=...   -> binary audio streams with Range support (googlevideo, sndcdn, ...)
//
// The Liner API itself is CORS-enabled upstream for GET/HEAD/POST (the hot
// path: feeds, search, library sync, login/register all stay direct). Its
// CORS policy does NOT list PATCH/PUT/DELETE in access-control-allow-methods,
// though — the desktop app never noticed because Electron opens CORS on every
// response, but a plain browser preflight-rejects those mutations. They are
// transparently rerouted through /api/fetch (see rewriteForWeb).

const SAME_ORIGIN_BYPASS = ["blob:", "data:", "about:", "chrome:", "resource:"];

// generic JSON/text upstreams (fetched with plain fetch, no Range semantics)
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
];

// binary media upstreams (fetched with Range/HEAD by the audio engine)
const MEDIA_HOSTS = [
  "googlevideo.com",
  "sndcdn.com", // cf-media, cf-hls-media, i1..i4, img, a1 ...
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

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith("." + suffix);
}

// methods the Liner API's CORS policy does not allow cross-origin:
// preflight returns access-control-allow-methods: GET,HEAD,POST only
const LINER_API_CORS_BLOCKED_METHODS = new Set(["PATCH", "PUT", "DELETE"]);

export function isWebProxyActive(): boolean {
  return typeof window !== "undefined";
}

/**
 * Rewrites a cross-origin URL to its same-origin proxy equivalent.
 * Passes through anything already relative, blob/data or same-origin.
 * `method` decides whether Liner API mutations go through /api/fetch.
 */
export function rewriteForWeb(rawUrl: string, method?: string): string {
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

  // the Liner API: GET/HEAD/POST are CORS-allowed upstream and stay direct
  // (matches DEFAULT_PRIMARY_API; anything on api.<base> must not be proxied).
  // PATCH/PUT/DELETE are not in the upstream allow-methods — send them through
  // the same-origin generic proxy instead.
  if (host === "api.tryliner.fun" || host === "api.tryliner.com") {
    if (method && LINER_API_CORS_BLOCKED_METHODS.has(method.toUpperCase())) {
      return `/api/fetch?u=${encodeURIComponent(url.toString())}`;
    }
    return rawUrl;
  }

  // Innertube: (music|www).youtube.com/youtubei/<...> -> /api/yt/<...>
  // (music.youtube.com is the WEB_REMIX catalog origin; www.youtube.com hosts
  // the TV / visionOS / Android VR playback profiles — both need the proxy so
  // x-liner-user-agent can be mapped to a real User-Agent upstream)
  // The host distinction matters: YouTube trusts a TV client context only on
  // the host a real TV client uses. The desktop hits www.youtube.com for those
  // profiles (Electron opens CORS), so the proxy must keep them apart instead
  // of flattening every youtubei call onto music.youtube.com.
  if (
    hostMatches(host, "youtube.com") &&
    (url.pathname.startsWith("/youtubei/") || url.pathname === "/youtubei")
  ) {
    const rest = `${url.pathname.slice("/youtubei".length)}${url.search}`;
    return host === "www.youtube.com" ? `/api/yt/www${rest}` : `/api/yt${rest}`;
  }

  // SABR UMP streaming: serverAbrStreamingUrl on youtube.com or any
  // googlevideo fallback host. These are long-lived binary protobuf POST
  // streams that deliver media chunks progressively — the generic /api/fetch
  // proxy buffers the whole body and 30s-times-out (the SabrStream client
  // watchdog aborts long before the buffered body arrives) and /api/media is
  // a Range proxy, not a chunk-pump. Dedicated streaming proxy: /api/yt/sabr.
  //
  // The streaming URL is usually /api/manifest/... but some player responses
  // hand out a plain /videoplayback?... URL directly (googlevideo r-nodes).
  // UMP streaming is ALWAYS a POST — GET range downloads (the <audio> element
  // and chunkedAudioDownload) must keep going through /api/media, so the
  // method decides: POST + manifest|videoplayback -> /api/yt/sabr.
  if (
    hostMatches(host, "youtube.com") ||
    hostMatches(host, "googlevideo.com")
  ) {
    const isManifestPath =
      url.pathname === "/api/manifest" ||
      url.pathname.startsWith("/api/manifest/");
    const isVideoPlaybackPath = url.pathname === "/videoplayback";
    if (isManifestPath || (isVideoPlaybackPath && method?.toUpperCase() === "POST")) {
      return `/api/yt/sabr?u=${encodeURIComponent(url.toString())}`;
    }
  }

  // SoundCloud API: api-v2.soundcloud.com/<...> -> /api/sc/<...>
  if (host === "api-v2.soundcloud.com") {
    return `/api/sc${url.pathname}${url.search}`;
  }

  // a-v2.sndcdn.com is script/text (clientId discovery) — must win over sndcdn media rule
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

let installed = false;

/**
 * Installs a global fetch interceptor that transparently routes cross-origin
 * requests through the web proxy. Must be called before any app code runs.
 */
export function installWebFetchProxy(): void {
  if (installed || typeof window === "undefined" || typeof window.fetch === "undefined") return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (typeof input === "string" || input instanceof URL) {
      const raw = input.toString();
      const rewritten = rewriteForWeb(raw, init?.method);
      if (rewritten === raw) return originalFetch(input as RequestInfo, init);
      return originalFetch(rewritten, init);
    }

    const rewritten = rewriteForWeb(input.url, input.method);
    if (rewritten === input.url) return originalFetch(input, init);

    const request = new Request(rewritten, input);
    return originalFetch(request, init);
  };
}
