// Shared allowlists for the Liner web-port proxy routes.
// Mirrors the host map in liner-app/src/shared/lib/webProxy.ts.

export const YT_UPSTREAM = "https://music.youtube.com";
// playback-profile origin (TVHTML5 / VISIONOS / ANDROID_VR) — see
// /api/yt/www/[...path]; the desktop sends those player requests here
export const YT_UPSTREAM_WWW = "https://www.youtube.com";
export const SC_UPSTREAM = "https://api-v2.soundcloud.com";

// generic JSON/text upstreams (oauth, imports, clientId discovery, ...)
export const FETCH_HOSTS = [
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
  // Liner API mutations (PATCH/PUT/DELETE): the upstream CORS policy only
  // lists GET, HEAD, POST in access-control-allow-methods, so the browser
  // blocks those methods when called cross-origin. They arrive here via the
  // method-aware rewrite in liner-app/src/shared/lib/webProxy.ts.
  "api.tryliner.fun",
  "api.tryliner.com",
  // AI lyrics translation (Settings > AI Translate): providers are called
  // through this proxy so API keys never need CORS exemptions and the free
  // Google Translate endpoint works from the browser. MyMemory is the free
  // failover when Google rate-limits the server IP.
  "translate.googleapis.com",
  "openrouter.ai",
  "generativelanguage.googleapis.com",
  "api.openai.com",
  "api.anthropic.com",
  "api.mymemory.translated.net",
];

// binary media upstreams (Range-capable audio streams)
export const MEDIA_HOSTS = [
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

export function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith("." + suffix);
}

export function isAllowedFetchHost(hostname: string): boolean {
  return FETCH_HOSTS.some((suffix) => hostMatches(hostname, suffix));
}

// SABR UMP streaming targets: serverAbrStreamingUrl usually lives at
// /api/manifest/... on www.youtube.com (googlevideo fallback hosts keep the
// same path when the SabrStream rotates r-nodes), but some player responses
// hand out a plain /videoplayback URL instead — both carry the UMP protobuf
// POST stream. Nothing else may be fetched through /api/yt/sabr.
export function isAllowedSabrTarget(url: URL): boolean {
  const host = url.hostname;
  const hostOk =
    hostMatches(host, "youtube.com") || hostMatches(host, "googlevideo.com");
  const pathOk =
    url.pathname === "/api/manifest" ||
    url.pathname.startsWith("/api/manifest/") ||
    url.pathname === "/videoplayback";
  return hostOk && pathOk;
}

export function isAllowedMediaHost(hostname: string): boolean {
  return MEDIA_HOSTS.some((suffix) => hostMatches(hostname, suffix));
}

// headers we never forward upstream
const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "accept-encoding",
  "origin",
  "referer",
  "cookie",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-forwarded-for",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "cdn-loop",
  "x-transformport",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
]);

export function forwardableHeaders(request: Request): Headers {
  const headers = new Headers();
  request.headers.forEach((value, name) => {
    if (!STRIP_REQUEST_HEADERS.has(name.toLowerCase())) {
      headers.set(name, value);
    }
  });
  return headers;
}

// response headers worth passing back to the app
const PASSTHROUGH_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "content-disposition",
  "etag",
  "last-modified",
  "expires",
  "cache-control",
  "date",
  "x-liner-server-time",
  "x-request-id",
  "retry-after",
  "location",
];

export function passthroughResponseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}
