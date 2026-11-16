import { useEffect, useRef } from "react";
import { cn } from "@/shared/lib";
import {
  humanCheckOrigins,
  humanCheckPageUrl,
  type HumanCheckAction,
} from "@/shared/api";
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

export default function CheckFrame({ action, attempt }: CheckFrameProps) {
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
