import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@classic/shared/lib";
import {
  humanCheckFrameBlocked,
  humanCheckOrigins,
  humanCheckPageUrl,
  type HumanCheckAction,
} from "@classic/shared/api";
import { useHumanCheckStore } from "../store/humanCheckStore";

interface CheckMessage {
  source?: string;
  action?: string;
  type?: "token" | "error" | "expired";
  token?: string;
  code?: string | number;
}

export interface CheckFrameProps {
  action: HumanCheckAction;
  attempt: number;
}

/**
 * Web mode: the verify page can never load in an iframe (upstream's WAF
 * challenge pages set X-Frame-Options, and the Turnstile widget itself is
 * domain-locked to Liner's origins — error 110200 anywhere else). A TOP-LEVEL
 * popup works instead: a Cloudflare interstitial is solvable there (first-
 * party context on Liner's own origin), and the page answers over postMessage
 * to window.opener — the same channel the desktop shell relies on.
 */
function CheckWindow({ action, attempt }: CheckFrameProps) {
  const solve = useHumanCheckStore((state) => state.solve);
  const fail = useHumanCheckStore((state) => state.fail);
  const phase = useHumanCheckStore((state) => state.phase);
  const [opened, setOpened] = useState<Window | null>(null);
  const [blocked, setBlocked] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const solvedRef = useRef(false);

  const openPopup = useCallback(() => {
    const popup = window.open(
      humanCheckPageUrl(action),
      "liner-verify",
      "popup=yes,width=430,height=620",
    );
    solvedRef.current = false;
    popupRef.current = popup;
    setOpened(popup);
    setBlocked(!popup);
  }, [action]);

  // token / error / expired arrive from the popup window
  useEffect(() => {
    const origins = humanCheckOrigins();
    const onMessage = (event: MessageEvent<CheckMessage>) => {
      if (!origins.includes(event.origin)) return;
      if (event.source !== popupRef.current) return;
      const data = event.data;
      if (data?.source !== "liner-turnstile" || data.action !== action) return;
      if (data.type === "token" && data.token) {
        solvedRef.current = true;
        solve(data.token);
      } else if (data.type === "expired") {
        fail("expired");
      } else if (data.type === "error") {
        fail(data.code ? String(data.code) : undefined);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [action, fail, solve]);

  // popup closed without a token = abandoned or interstitial dismissed
  useEffect(() => {
    if (!opened) return;
    const timer = setInterval(() => {
      if (opened.closed && !solvedRef.current) {
        clearInterval(timer);
        popupRef.current = null;
        setOpened(null);
        fail();
      }
    }, 800);
    return () => clearInterval(timer);
  }, [opened, fail]);

  // each retry remounts this component — drop the stale popup reference
  useEffect(() => {
    setOpened(null);
    setBlocked(false);
  }, [attempt]);

  return (
    <div className="flex flex-col items-center gap-[10px] px-[6px]">
      <button
        type="button"
        onClick={openPopup}
        className="h-[40px] w-full rounded-[12px] bg-accent-primary px-[18px] text-[14.5px] font-[500] text-white transition-opacity hover:opacity-90"
      >
        {opened ? "Re-open verification window" : "Open verification window"}
      </button>
      <p className="text-center text-[12.5px] leading-[1.4] text-text-secondary">
        {blocked
          ? "Your browser blocked the popup — allow popups for this site and try again."
          : opened
            ? "Complete the check in the popup window. This page continues automatically once Liner verifies you."
            : "Liner's verification runs in its own popup window."}
      </p>
      {phase === "expired" && (
        <p className="text-center text-[12.5px] text-text-secondary">
          The check expired — open the window again.
        </p>
      )}
    </div>
  );
}

export default function CheckFrame(props: CheckFrameProps) {
  // the iframe path only works where the browser's own profile clears
  // upstream's WAF and the page loads un-framed (the desktop shell)
  if (humanCheckFrameBlocked()) return <CheckWindow {...props} />;
  return <CheckFrameIframe {...props} />;
}

function CheckFrameIframe({ action, attempt }: CheckFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const phase = useHumanCheckStore((state) => state.phase);
  const setPhase = useHumanCheckStore((state) => state.setPhase);
  const solve = useHumanCheckStore((state) => state.solve);
  const fail = useHumanCheckStore((state) => state.fail);
  const ready = phase !== "loading";
  const watchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearWatch = () => {
    if (watchRef.current) {
      clearTimeout(watchRef.current);
      watchRef.current = null;
    }
  };

  useEffect(() => clearWatch, []);

  useEffect(() => {
    const origins = humanCheckOrigins();
    const onMessage = (event: MessageEvent<CheckMessage>) => {
      if (!origins.includes(event.origin)) return;
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data;
      if (data?.source !== "liner-turnstile" || data.action !== action) return;
      if (data.type === "token" && data.token) solve(data.token);
      else if (data.type === "expired") setPhase("expired");
      else if (data.type === "error")
        fail(data.code ? String(data.code) : undefined);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [action, fail, setPhase, solve]);

  const markLoaded = () => {
    if (useHumanCheckStore.getState().phase === "loading") setPhase("ready");
    // a frame that loads but never talks back is stuck on upstream's WAF
    // challenge page (Cloudflare managed challenges don't render in
    // iframes) — stop waiting and surface the guidance after 25s
    clearWatch();
    watchRef.current = setTimeout(() => {
      if (useHumanCheckStore.getState().phase === "ready") fail();
    }, 25_000);
  };

  return (
    <div className="relative mx-auto h-[88px] w-[320px] shrink-0">
      <div
        className={cn(
          "absolute inset-x-[10px] top-[11px] h-[65px] animate-pulse rounded-[10px] bg-black/[0.08] transition-opacity duration-300 dark:bg-white/[0.1]",
          ready && "opacity-0",
        )}
      />
      <iframe
        key={attempt}
        ref={frameRef}
        src={humanCheckPageUrl(action)}
        title="Cloudflare Turnstile"
        scrolling="no"
        onLoad={markLoaded}
        className={cn(
          "absolute inset-0 size-full border-0 bg-transparent opacity-0 transition-opacity duration-300 ease-out [color-scheme:dark]",
          ready && "opacity-100",
        )}
      />
    </div>
  );
}
