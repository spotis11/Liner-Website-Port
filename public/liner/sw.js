/*
 * Liner web app-shell service worker (scope: /liner/).
 *
 * Goals:
 *  - the SPA shell (index.html + hashed /liner/assets/*) keeps working offline
 *  - cover art keeps its existing offline cache (reuses the liner-covers-v2
 *    cache that cover-sw.js established, so nothing is re-downloaded)
 *  - API calls are never cached (auth + freshness)
 *  - audio offline support lives in IndexedDB (downloads feature) — this SW
 *    deliberately ignores Range requests so <audio> keeps streaming semantics
 */
const SHELL_CACHE = "liner-shell-v1";
const COVER_CACHE = "liner-covers-v2";
const COVER_MAX_ENTRIES = 600;

const COVER_HOSTS = [
  "yt3.googleusercontent.com",
  "lh3.googleusercontent.com",
  "covers.tryliner.fun",
  "i1.sndcdn.com",
  "i2.sndcdn.com",
  "i3.sndcdn.com",
  "i4.sndcdn.com",
  "img.sndcdn.com",
  "a1.sndcdn.com",
  "i.pinimg.com",
  "images.genius.com",
  "yandex-images.clstorage.net",
];

const ASSET_PREFIX = "/liner/assets/";
const INDEX_PATHS = ["/liner", "/liner/", "/liner/index.html"];

function isCoverUrl(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.pathname || parsed.pathname === "/" || parsed.pathname === "/health") {
      return false;
    }
    return COVER_HOSTS.some(
      (host) =>
        parsed.hostname === host || parsed.hostname.endsWith("." + host),
    );
  } catch {
    return false;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // precache the shell so a first-time visitor is offline-ready on the
      // second load without any extra work
      try {
        const cache = await caches.open(SHELL_CACHE);
        const response = await fetch("/liner/index.html", { cache: "no-store" });
        if (response.ok) await cache.put("/liner/index.html", response.clone());
      } catch {}
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== COVER_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

// hashed SPA bundles are immutable: cache-first, keep the cache bounded
const ASSET_MAX_ENTRIES = 300;
async function assetFetch(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    try {
      const keys = await cache.keys();
      if (keys.length > ASSET_MAX_ENTRIES) {
        for (const key of keys.slice(0, keys.length - ASSET_MAX_ENTRIES)) {
          await cache.delete(key);
        }
      }
    } catch {}
  }
  return response;
}

// index.html: network-first so deploys land immediately, cache fallback for
// offline starts
async function shellFetch(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) {
      await cache.put("/liner/index.html", response.clone());
    }
    return response;
  } catch {
    const cached =
      (await cache.match("/liner/index.html", { ignoreVary: true })) ||
      (await cache.match(request, { ignoreVary: true }));
    if (cached) return cached;
    throw new Error("offline and no cached shell");
  }
}

const coverInFlight = new Map();
async function coverFetch(request) {
  const cacheKey = request.url;
  const cache = await caches.open(COVER_CACHE);
  const cached = await cache.match(cacheKey, { ignoreVary: true });
  if (cached) return cached;

  let pending = coverInFlight.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(request);
      if (response.ok && response.type !== "opaque") {
        await cache.put(cacheKey, response.clone());
        try {
          const keys = await cache.keys();
          if (keys.length > COVER_MAX_ENTRIES) {
            for (const key of keys.slice(0, keys.length - COVER_MAX_ENTRIES)) {
              await cache.delete(key);
            }
          }
        } catch {}
      }
      return response;
    })().finally(() => coverInFlight.delete(cacheKey));
    coverInFlight.set(cacheKey, pending);
  }
  return (await pending).clone();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  // let <audio> range streaming pass through untouched
  if (request.headers.has("range")) return;

  const url = new URL(request.url);

  if (isCoverUrl(request.url)) {
    event.respondWith(
      coverFetch(request).catch(() => fetch(request)),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // the Next.js backend is always network-only (auth, freshness)
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith(ASSET_PREFIX)) {
    event.respondWith(assetFetch(request));
    return;
  }

  if (INDEX_PATHS.includes(url.pathname)) {
    event.respondWith(shellFetch(request));
    return;
  }

  // other same-origin static files under /liner (icons, fonts, sw assets):
  // cache-first with network fill
  if (url.pathname.startsWith("/liner/")) {
    event.respondWith(
      cacheFirst(request, SHELL_CACHE).catch(() => fetch(request)),
    );
  }
});
