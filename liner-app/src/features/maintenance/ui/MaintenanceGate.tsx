import { useEffect } from "react";
import { playerRuntime } from "@/features/player";
import { fetchMaintenanceStatus } from "../lib/maintenanceApi";
import { decideMaintenanceAction, useMaintenanceStore } from "../store/maintenanceStore";
import { MaintenanceScreen } from "./MaintenanceScreen";

/** How often an open client re-checks the maintenance switch. */
const CHECK_INTERVAL_MS = 30 * 1000;

/**
 * Website-port maintenance gate. Runs the status probe on boot, every 30
 * seconds while the app is open and whenever the tab becomes visible again.
 * When the backend answers "maintaining", playback is paused and the
 * full-screen maintenance overlay covers the app — sign-in included — so
 * nobody can sign in or listen while the wall is up.
 *
 * The wall persists across reloads (normal and hard): the active state is
 * mirrored to localStorage by the store, so it is back on the very first
 * paint after a refresh. Only an authoritative `enabled: false` from the
 * website backend releases it — a failed or timed-out probe keeps an
 * existing wall up instead of revealing the app.
 */
export function MaintenanceGate() {
  const active = useMaintenanceStore((s) => s.active);
  const reasons = useMaintenanceStore((s) => s.reasons);

  useEffect(() => {
    let disposed = false;

    const run = async () => {
      if (disposed) return;
      try {
        const status = await fetchMaintenanceStatus().catch(() => null);
        if (disposed || !status) return; // probe failed → an up wall stays up
        const decision = decideMaintenanceAction(status);
        if (decision.action === "wall") {
          // pause whatever is playing so nothing keeps sounding behind the wall
          try {
            playerRuntime?.pause();
          } catch {
            // the wall still goes up even if the player refuses
          }
          useMaintenanceStore.getState().setActive(status);
        } else if (useMaintenanceStore.getState().active) {
          // authoritative "maintenance over" from the website backend — release
          useMaintenanceStore.getState().clearActive();
        }
      } catch {
        // the gate must never crash the app
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

  if (!active) return null;
  return <MaintenanceScreen reasons={reasons} />;
}

export default MaintenanceGate;
