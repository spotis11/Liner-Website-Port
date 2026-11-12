import { useEffect } from "react";
import { fetchShowcaseStatus } from "../lib/showcaseApi";
import {
  REAL_SITE_NAME,
  SHOWCASE_TICK_MS,
  randomSiteName,
} from "../lib/showcaseName";
import { decideShowcaseAction, useShowcaseStore } from "../store/showcaseStore";

/** How often an open client re-checks the showcase switch. */
const CHECK_INTERVAL_MS = 15 * 1000;

/**
 * Website Showcase controller. Runs the status probe on boot, every 15
 * seconds while the app is open and whenever the tab becomes visible
 * again (same rhythm as the ban and maintenance gates). While the backend
 * says showcase mode is on, the browser tab title re-rolls into random
 * letters every few milliseconds; when it says off, the real name is
 * restored. React text nodes hooked via useShowcaseName() scramble in
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

  return null;
}

export default ShowcaseSync;
