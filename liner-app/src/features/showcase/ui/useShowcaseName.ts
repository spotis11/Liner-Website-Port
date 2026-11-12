import { useEffect, useState } from "react";
import {
  REAL_SITE_NAME,
  SHOWCASE_TICK_MS,
  randomSiteName,
} from "../lib/showcaseName";
import { useShowcaseStore } from "../store/showcaseStore";

/**
 * Scrambling site name for React text nodes (the login wordmark and any
 * other place that renders the website's name as text). While showcase
 * mode is off this returns the real name; while it is on, the name re-rolls
 * into random letters every few milliseconds, in step with the tab title.
 */
export function useShowcaseName(fallback: string = REAL_SITE_NAME): string {
  const active = useShowcaseStore((s) => s.active);
  const [name, setName] = useState(active ? randomSiteName() : fallback);

  useEffect(() => {
    if (!active) {
      setName(fallback);
      return;
    }
    setName(randomSiteName());
    const timer = window.setInterval(() => {
      setName(randomSiteName());
    }, SHOWCASE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [active, fallback]);

  return name;
}

export default useShowcaseName;
