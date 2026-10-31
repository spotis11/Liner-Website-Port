import { useEffect } from "react";

/**
 * Registers the web app-shell service worker (/liner/sw.js): offline SPA
 * shell, hashed-asset cache and cover-art cache in one worker. Electron
 * builds never register (and actively unregister) — IndexedDB is the only
 * offline layer there. Dev servers skip registration so HMR stays clean.
 */
export function CoverSwRegistrar() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const isElectron =
      window.location.protocol === "file:" ||
      typeof (window as any).linerElectron !== "undefined";

    if (isElectron || !import.meta.env.PROD) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const reg of registrations) {
          void reg.unregister();
        }
      });
      return;
    }

    // web prod: single /liner/-scoped worker (replaces the legacy "/"-scoped
    // cover-sw.js registration)
    navigator.serviceWorker
      .register("/liner/sw.js", { scope: "/liner/" })
      .catch(() => {
        // SW registration failure is non-fatal — app still works online.
      });
  }, []);

  return null;
}
