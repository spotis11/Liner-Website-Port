import { useEffect } from "react";

/**
 * Registers the web app-shell service worker. The root worker (/sw.js,
 * scope /) controls every document path — that scope is what makes the
 * installed PWA start and refresh offline (hash routes all live under /).
 * It caches the SPA shell, hashed /liner/assets/* and cover art; audio
 * offline stays in IndexedDB (downloads feature). Electron builds never
 * register (and actively unregister) — IndexedDB is the only offline layer
 * there. Dev servers skip registration so HMR stays clean.
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

    // web prod: one root-scoped worker; retire the older /liner/ and "/"
    // registrations so every page ends up controlled by /sw.js
    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          const scope = new URL(reg.scope).pathname;
          if (scope === "/") continue;
          await reg.unregister();
        }
      } catch {
        // SW registration failure is non-fatal — app still works online.
      }
    };
    void register();
  }, []);

  return null;
}
