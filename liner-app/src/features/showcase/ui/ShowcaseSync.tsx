import { useEffect } from "react";
import { fetchShowcaseStatus } from "../lib/showcaseApi";
import {
  REAL_SITE_NAME,
  SHOWCASE_TICK_MS,
  SHOWCASE_URL_PARAM,
  SHOWCASE_URL_TICK_MS,
  randomSiteName,
  randomUrlJunk,
} from "../lib/showcaseName";
import { decideShowcaseAction, useShowcaseStore } from "../store/showcaseStore";

/** How often an open client re-checks the showcase switch. */
const CHECK_INTERVAL_MS = 15 * 1000;

/**
 * Website Showcase controller. Runs the status probe on boot, every 15
 * seconds while the app is open and whenever the tab becomes visible
 * again (same rhythm as the ban and maintenance gates). While the backend
 * says showcase mode is on:
 *   - the browser tab title re-rolls into random letters every few
 *     milliseconds,
 *   - the address bar's query string re-rolls too (history.replaceState,
 *     ?liner=<junk>) so the visible URL keeps mutating — the domain
 *     itself is browser chrome no website can ever touch, and the #/route
 *     hash is the app's own navigation state, so it is left alone.
 * When it says off, the real name comes back and the junk query is
 * stripped. React text nodes hooked via useShowcaseName() scramble in
 * step with the same tick.
 */
export function ShowcaseSync() {
  const active = useShowcaseStore((s) => s.active);

  // probe loop — keeps every open client in sync with the owner's switch
  useEffect(() => {
    let disposed = false;

    const run = async () => {
      if (disposed) return;
      try {
        const status = await fetchShowcaseStatus().catch(() => null);
        if (disposed || !status) return; // probe failed → keep current state
        const decision = decideShowcaseAction(status);
        if (decision.action === "start") {
          useShowcaseStore.getState().setActive(status);
        } else if (useShowcaseStore.getState().active) {
          useShowcaseStore.getState().clearActive();
        }
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

  // the address-bar scramble: junk query only — hash (router state) and
  // path stay put, so navigation and refreshes keep working
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      try {
        // pass the router's own history state through untouched — React
        // Router bookkeeping rides in history.state and must survive
        window.history.replaceState(
          window.history.state,
          "",
          `?${SHOWCASE_URL_PARAM}=${randomUrlJunk()}${window.location.hash}`,
        );
      } catch {
        // rate-limited (Safari) or transient — skip this tick
      }
    };
    tick();
    const timer = window.setInterval(tick, SHOWCASE_URL_TICK_MS);
    return () => {
      window.clearInterval(timer);
      // restore a clean URL: drop the junk query, keep path + hash
      try {
        window.history.replaceState(
          window.history.state,
          "",
          `${window.location.pathname}${window.location.hash}`,
        );
      } catch {
        // nothing sensible to do — the next navigation cleans it anyway
      }
    };
  }, [active]);

  return null;
}

export default ShowcaseSync;
