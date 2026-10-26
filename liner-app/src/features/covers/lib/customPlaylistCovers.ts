/**
 * Custom playlist covers.
 *
 * The Liner backend has no cover-upload endpoint (`PATCH /v1/me/playlists`
 * only accepts title/description/isPublic), so custom covers are stored
 * client-side in IndexedDB, keyed by playlist id. Every surface that renders
 * a playlist cover (library grid, playlist page hero, page backdrop, the
 * player context passed to playTrack) reads through the hooks below and
 * shows the custom image instead of the auto-derived track covers when one
 * exists.
 *
 * Images are downscaled to a square JPEG at pick time (cover-fit crop) so a
 * 600×600 cover costs ~40-120KB — IndexedDB handles thousands of those.
 *
 * Animated GIFs are the exception: they are stored byte-for-byte as uploaded
 * (no canvas re-encode, which would flatten them to their first frame), so
 * covers animate everywhere an <img>/background-image renders them.
 */

const DB_NAME = "liner_custom_covers_v1";
const DB_VERSION = 1;
const STORE = "covers";

export interface CustomCoverRecord {
  id: string;
  blob: Blob;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    });
  }
  return dbPromise;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function notify(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

const urlCache = new Map<string, string>(); // playlistId -> object URL ("" = known absent)
const CHANGE_EVENT = "custom-covers:changed";

async function loadUrl(id: string): Promise<string | undefined> {
  if (urlCache.has(id)) return urlCache.get(id) || undefined;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const rec = await requestToPromise<CustomCoverRecord | undefined>(
      tx.objectStore(STORE).get(id) as IDBRequest<CustomCoverRecord | undefined>,
    );
    if (rec?.blob) {
      const url = URL.createObjectURL(rec.blob);
      urlCache.set(id, url);
      return url;
    }
    urlCache.set(id, "");
    return undefined;
  } catch {
    return undefined;
  }
}

/** Resolves the custom cover object URL for a playlist, if one is stored. */
export function getCustomCoverUrl(id: string): Promise<string | undefined> {
  return loadUrl(id);
}

/** Bulk read used by the library grid — resolves every stored custom cover. */
export async function getAllCustomCoverUrls(
  ids: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    ids.map(async (id) => {
      const url = await loadUrl(id);
      if (url) out[id] = url;
    }),
  );
  return out;
}

/**
 * Persists (and replaces) a custom cover. Pass a square-cropped JPEG blob, or
 * the original file for animated GIFs (see fileToSquareCoverBlob).
 */
export async function setCustomCover(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  await requestToPromise(
    tx.objectStore(STORE).put({ id, blob, updatedAt: Date.now() }),
  );
  const prev = urlCache.get(id);
  if (prev) URL.revokeObjectURL(prev);
  urlCache.set(id, URL.createObjectURL(blob));
  notify();
}

/** Removes a custom cover — the playlist falls back to its auto cover. */
export async function removeCustomCover(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  await requestToPromise(tx.objectStore(STORE).delete(id));
  const prev = urlCache.get(id);
  if (prev) URL.revokeObjectURL(prev);
  urlCache.set(id, "");
  notify();
}

// ---------------------------------------------------------------------------
// React glue: object URLs live per session, so the module keeps a
// playlistId -> objectURL map; mutations broadcast a window event so every
// mounted surface (library grid, hero, backdrop) re-resolves in lockstep.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";

const EMPTY_MAP: Record<string, string> = {};

/** Single-playlist hook (playlist page hero, backdrop, player context). */
export function useCustomPlaylistCoverUrl(
  playlistId: string | null | undefined,
): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => {
    if (!playlistId) return undefined;
    const cached = urlCache.get(playlistId);
    return cached ? cached : undefined;
  });

  useEffect(() => {
    if (!playlistId) {
      setUrl(undefined);
      return;
    }
    let active = true;
    void loadUrl(playlistId).then((resolved) => {
      if (active) setUrl(resolved);
    });
    const onChange = () => {
      void loadUrl(playlistId).then((resolved) => {
        if (active) setUrl(resolved);
      });
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => {
      active = false;
      window.removeEventListener(CHANGE_EVENT, onChange);
    };
  }, [playlistId]);

  return url;
}

/**
 * Map hook for lists (library grid): resolves custom covers for many
 * playlists at once and re-resolves whenever any of them changes.
 */
export function useCustomPlaylistCoverMap(
  playlistIds: string[],
): Record<string, string> {
  const key = useMemo(() => playlistIds.join("|"), [playlistIds]);
  const [map, setMap] = useState<Record<string, string>>(EMPTY_MAP);

  useEffect(() => {
    let active = true;
    const ids = key ? key.split("|") : [];
    const resolve = () => {
      void getAllCustomCoverUrls(ids).then((resolved) => {
        if (active) setMap(resolved);
      });
    };
    resolve();
    window.addEventListener(CHANGE_EVENT, resolve);
    return () => {
      active = false;
      window.removeEventListener(CHANGE_EVENT, resolve);
    };
  }, [key]);

  return map;
}

// ---------------------------------------------------------------------------
// Image downscaling — square cover crop, mirrors how desktop crop artwork.
// ---------------------------------------------------------------------------

const COVER_SIZE = 600;

/**
 * True when the blob is a GIF containing more than one frame. Scans for
 * Graphic Control Extension markers (0x21 0xF9) — one per frame; a static GIF
 * has at most one. Cheap byte scan, no decode, safe false-positive direction
 * (a misdetection just stores the original file, which still renders fine).
 */
export async function isAnimatedGif(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 6).arrayBuffer());
  const sig = String.fromCharCode(...head);
  if (sig !== "GIF87a" && sig !== "GIF89a") return false;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let extensions = 0;
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9) {
      extensions++;
      if (extensions >= 2) return true;
    }
  }
  return false;
}

/**
 * Crops any image file to a centered square JPEG blob (600×600), keeping EXIF
 * orientation via createImageBitmap's imageOrientation option when available.
 * Animated GIFs skip the crop entirely and are returned as uploaded so the
 * animation survives (canvas rendering only captures the first frame).
 */
export async function fileToSquareCoverBlob(file: Blob): Promise<Blob> {
  if (await isAnimatedGif(file)) return file;
  const bitmap = await loadBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = COVER_SIZE;
    canvas.height = COVER_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d unavailable");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, COVER_SIZE, COVER_SIZE);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.86),
    );
    if (!blob) throw new Error("canvas encode failed");
    return blob;
  } finally {
    if ("close" in bitmap) {
      (bitmap as ImageBitmap).close();
    }
  }
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, {
        imageOrientation: "from-image",
      } as ImageBitmapOptions);
    } catch {
      // fall through to <img> decoding (Safari options, SVGs, etc.)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image decode failed"));
      img.src = url;
    });
    return img;
  } finally {
    // decode is done; revoke lazily so drawImage always has valid pixels
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
