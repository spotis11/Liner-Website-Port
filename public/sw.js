/*
 * Liner web PWA service worker (scope: /).
 *
 * Goals:
 *  - the SPA shell (index.html + hashed /liner/assets/*) keeps working
 *    offline for EVERY document path — this root scope is what makes the
 *    installed PWA start and refresh without a network (the app routes
 *    under /, so a /liner/-scoped worker never controlled them)
 *  - cover art keeps its existing offline cache (reuses liner-covers-v2)
 *  - API calls are never cached (auth + freshness)
 *  - audio offline support lives in IndexedDB (downloads feature) — this SW
 *    deliberately ignores Range requests so <audio> keeps streaming semantics
 */
const SHELL_CACHE = "liner-shell-v3";
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
// the canonical SPA document — every navigation falls back to it offline
const SHELL_URL = "/liner/index.html";

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
        const response = await fetch(SHELL_URL, { cache: "no-store" });
        if (response.ok) await cache.put(SHELL_URL, response.clone());
      } catch {}
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // keep liner-shell-v2 alive during the /liner/sw.js -> /sw.js
      // migration: the outgoing worker may still serve from it for a moment
      const keep = new Set([SHELL_CACHE, COVER_CACHE, "liner-shell-v2"]);
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
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

// documents: network-first so deploys land immediately, cache fallback so a
// refresh offline still boots the app (PWA start_url "/" included)
async function shellFetch(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) {
      await cache.put(SHELL_URL, response.clone());
      await cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached =
      (await cache.match(request, { ignoreVary: true })) ||
      (await cache.match(SHELL_URL, { ignoreVary: true }));
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

  // the Next.js backend is always network-only (auth, freshness, relay)
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/v1/")) return;

  if (request.mode === "navigate") {
    event.respondWith(shellFetch(request));
    return;
  }

  if (url.pathname.startsWith(ASSET_PREFIX)) {
    event.respondWith(assetFetch(request));
    return;
  }

  // other same-origin files (liner static assets, manifest, icons, sw.js
  // itself, root-level favicon/logo): cache-first with network fill
  event.respondWith(
    cacheFirst(request, SHELL_CACHE).catch(() => fetch(request)),
  );
});
