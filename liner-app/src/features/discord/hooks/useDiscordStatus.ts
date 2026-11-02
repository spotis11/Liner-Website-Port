import { useEffect, useState } from "react";
import type { DiscordConnectionStatus } from "../contracts";
import { discordGateway } from "../lib/discordGateway";

const POLL_INTERVAL_MS = 4000;

export function useDiscordStatus() {
  const [status, setStatus] = useState<DiscordConnectionStatus>({
    connected: false,
  });
  const [loading, setLoading] = useState(true);

  const isElectron =
    typeof window !== "undefined" && Boolean(window.linerElectron?.getDiscordStatus);

  useEffect(() => {
    if (!isElectron) return;
    let cancelled = false;

    const checkStatus = () => {
      const getStatus = window.linerElectron?.getDiscordStatus;
      if (!getStatus) {
        setLoading(false);
        return;
      }
      void getStatus()
        .then((next) => {
          if (!cancelled && next) setStatus(next);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    checkStatus();
    const interval = setInterval(checkStatus, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isElectron]);

  // Web: subscribe to the gateway client status
  useEffect(() => {
    if (isElectron) return;
    let cancelled = false;
    const apply = () => {
      const s = discordGateway.getStatus();
      if (cancelled) return;
      setStatus({
        connected: s.connected,
        username: s.username,
        avatarUrl: s.avatarUrl,
      });
      setLoading(false);
    };
    const unsubscribe = discordGateway.subscribe(() => apply());
    apply();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isElectron]);

  return { status, loading };
}
