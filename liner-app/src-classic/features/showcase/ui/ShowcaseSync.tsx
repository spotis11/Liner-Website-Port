import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { fetchShowcaseStatus } from "../lib/showcaseApi";
import {
  REAL_SITE_NAME,
  SHOWCASE_COVER_PATH,
  SHOWCASE_COVER_TICK_MS,
  SHOWCASE_TICK_MS,
  randomSiteName,
  realHrefForLocation,
  shouldCoverUrl,
} from "../lib/showcaseName";
import { applyShowcaseStatus, useShowcaseStore } from "../store/showcaseStore";

/** How often an open client re-checks the showcase switch. */
const CHECK_INTERVAL_MS = 15 * 1000;

/**
 * Website Showcase controller. Runs the status probe on boot, every 15
 * seconds while the app is open and whenever the tab becomes visible
 * again (same rhythm as the ban and maintenance gates). While the backend
 * says showcase mode is on:
 *   - the browser tab title re-rolls into random letters every few
 *     milliseconds,
 *   - the address bar is COVERED: everything after the domain (query
 *     string and the #/route fragment) is swept away via
 *     history.replaceState so the bar shows nothing but the bare domain —
 *     e.g. https://liner-music.space-z.ai/. replaceState never fires
 *     hashchange/popstate, so the HashRouter keeps its in-memory view and
 *     the app keeps running exactly where it is; a refresh on the covered
 *     URL simply boots the site again (the server serves the SPA at "/").
 *     The domain itself is browser chrome no website can ever touch.
 * When it says off, the real name comes back and the address bar is
 * handed back to the router. React text nodes hooked via useShowcaseName()
 * scramble in step with the same tick.
 */
export function ShowcaseSync() {
  const active = useShowcaseStore((s) => s.active);
  const location = useLocation();

  // the freshest router location for the off-switch cleanup below (the
  // restore effect must not depend on `location`, or every navigation
  // would flip the bar to the real URL for a frame before re-covering)
  const locationRef = useRef(location);
  locationRef.current = location;

  // probe loop — keeps every open client in sync with the owner's switch
  useEffect(() => {
    let disposed = false;

    const run = async () => {
      if (disposed) return;
      try {
        const status = await fetchShowcaseStatus().catch(() => null);
        if (disposed || !status) return; // probe failed → keep current state
        applyShowcaseStatus(status);
      } catch {
        // the controller must never crash the app
      }
    };

    void run();
    const timer = window.setInterval(() => void run(), CHECK_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // the actual scramble on the browser tab title
  useEffect(() => {
    if (!active) {
      // restore the real name no matter what scrambled it before
      document.title = REAL_SITE_NAME;
      return;
    }
    document.title = randomSiteName();
    const timer = window.setInterval(() => {
      // background tabs do not need the glitch show — skip quietly
      if (document.visibilityState !== "visible") return;
      document.title = randomSiteName();
    }, SHOWCASE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [active]);

  // the address-bar cover: sweep the URL down to the bare domain while
  // showcase is on. The router's own navigation and any history move are
  // re-covered on the spot; the interval is the backstop for anyone else
  // who writes to the URL.
  useEffect(() => {
    if (!active) return;

    const cover = () => {
      try {
        const { pathname, search, hash } = window.location;
        if (!shouldCoverUrl(pathname, search, hash)) return;
        // pass the router's own history state through untouched — React
        // Router bookkeeping rides in history.state and must survive
        window.history.replaceState(
          window.history.state,
          "",
          SHOWCASE_COVER_PATH,
        );
      } catch {
        // rate-limited (Safari) or transient — the next tick re-covers
      }
    };

    cover();
    const timer = window.setInterval(cover, SHOWCASE_COVER_TICK_MS);
    window.addEventListener("popstate", cover);
    window.addEventListener("hashchange", cover);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("popstate", cover);
      window.removeEventListener("hashchange", cover);
      // hand the real URL back: rebuild it from the router's own location
      // so the address bar matches the view the app is actually on
      try {
        const { pathname, search } = locationRef.current;
        window.history.replaceState(
          window.history.state,
          "",
          realHrefForLocation(pathname, search),
        );
      } catch {
        // nothing sensible to do — the next navigation writes a real URL
      }
    };
  }, [active]);

  // navigation while covered: the HashRouter just wrote "#/route" into the
  // bar — sweep it away immediately instead of waiting for the tick
  useEffect(() => {
    if (!active) return;
    try {
      const { pathname, search, hash } = window.location;
      if (!shouldCoverUrl(pathname, search, hash)) return;
      window.history.replaceState(
        window.history.state,
        "",
        SHOWCASE_COVER_PATH,
      );
    } catch {
      // rate-limited (Safari) — the backstop interval re-covers shortly
    }
  }, [active, location]);

  return null;
}

export default ShowcaseSync;
