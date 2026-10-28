import { useEffect } from "react";
import { useAuthStore } from "@/features/auth";
import { getValidAccessToken } from "@/shared/api/auth-session";
import { checkBan } from "../lib/moderationApi";
import { decideBanGateAction, useBanStore } from "../store/banStore";
import { BannedScreen } from "./BannedScreen";

/** How often an open client re-checks its ban status. */
const CHECK_INTERVAL_MS = 4 * 60 * 1000;

/**
 * Website-port enforcement gate. Runs the ban probe on boot, on every
 * sign-in state change, every 4 minutes while the app is open and whenever
 * the tab becomes visible again. When the probe answers "banned", the
 * signed-in session is dropped and the full-screen banned overlay covers
 * the app — banned visitors cannot sign in and banned sessions are kicked.
 *
 * The wall persists across reloads (normal and hard): the active ban is
 * mirrored to localStorage by the store, so it is back on the very first
 * paint after a refresh. A browser that was already shown a ban re-probes
 * with the remembered username even while signed out, so the wall stays up
 * until the WEBSITE BACKEND releases it (ban lifted or expired) — a failed
 * or timed-out probe keeps an existing wall up instead of revealing the app.
 */
export function BanGate() {
  const ban = useBanStore((s) => s.ban);
  const authStatus = useAuthStore((s) => s.status);
  const username = useAuthStore((s) => s.user?.username);

  useEffect(() => {
    let disposed = false;

    const run = async () => {
      if (disposed) return;
      try {
        const state = useAuthStore.getState();
        const active =
          state.status === "authenticated" ? (state.user?.username ?? null) : null;
        const accessToken =
          state.status === "authenticated"
            ? await getValidAccessToken().catch(() => null)
            : null;
        // A walled browser keeps probing under its remembered ban identity
        // even when its session was dropped, so "is it over yet?" is always
        // answered by the server, never by the client going quiet.
        const remembered = useBanStore.getState().ban;
        const probeName = active ?? remembered?.username ?? null;
        const result = await checkBan(probeName, accessToken).catch(() => null);
        if (disposed || !result) return; // probe failed → an up wall stays up
        // Capture the profile picture BEFORE any session drop: the live
        // session's avatar belongs to the verified account; when already
        // signed out, keep the avatar the persisted record captured earlier.
        const liveAvatar =
          state.status === "authenticated"
            ? (state.user?.avatarUrl ?? null)
            : null;
        const rememberedAvatar = remembered?.avatarUrl ?? null;
        const decision = decideBanGateAction(result, probeName, liveAvatar ?? rememberedAvatar);
        if (decision.action === "wall") {
          // drop the session first so nothing keeps playing behind the wall
          const current = useAuthStore.getState();
          if (current.status === "authenticated") {
            try {
              await current.logout();
            } catch {
              // even if logout hiccups, the wall still goes up
            }
          }
          useBanStore.getState().setBan(decision.ban);
        } else if (useBanStore.getState().ban) {
          // authoritative "not banned" from the website backend — release
          useBanStore.getState().clearBan();
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
  }, [authStatus, username]);

  if (!ban) return null;
  return <BannedScreen ban={ban} />;
}

export default BanGate;
