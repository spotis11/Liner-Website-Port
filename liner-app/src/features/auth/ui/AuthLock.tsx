import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { getAuthSession } from "@/shared/api";
import AppFrame from "@/features/navigation/ui/AppFrame";
import { useWindowState } from "@/features/navigation/hooks/useWindowState";

// design-preview harness: with `?_design=1` in a dev build the shell renders
// without a session so screens can be screenshotted; prod builds compile this
// whole branch out (import.meta.env.DEV === false)
const DESIGN_PREVIEW =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  window.location.hash.includes("_design=1");

export function AuthLock({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const status = useAuthStore((state) => state.status);
  const initialize = useAuthStore((state) => state.initialize);
  // keeps the body's outer padding in step with maximize / fullscreen on every screen,
  // including login and the startup spinner (the app frame mounts its own copy too)
  const { isEdgeToEdge } = useWindowState();

  useEffect(() => {
    if (DESIGN_PREVIEW) {
      useAuthStore.setState({
        status: "authenticated",
        user: {
          id: "preview-user",
          username: "olya",
          displayName: "Olya Hnatiuk",
          avatarUrl: null,
        },
      });
      return;
    }
    void initialize();
  }, [initialize]);

  useEffect(() => {
    const syncExpiredSession = () => {
      if (!getAuthSession()) void initialize();
    };
    window.addEventListener("auth:changed", syncExpiredSession);
    return () => window.removeEventListener("auth:changed", syncExpiredSession);
  }, [initialize]);

  // Revalidate the session when the user returns to a long-inactive tab.
  // A stale-looking session (token still in localStorage but the DB row was
  // wiped by a deploy/mirror cycle) is only discovered on the next API call;
  // this surfaces it proactively so the user sees the login redirect
  // immediately rather than a broken library load.
  useEffect(() => {
    let hiddenAt: number | null = null;
    const VISIBILITY_THRESHOLD_MS = 30_000;
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null) {
        const hiddenFor = Date.now() - hiddenAt;
        hiddenAt = null;
        if (hiddenFor >= VISIBILITY_THRESHOLD_MS && getAuthSession()) {
          void initialize();
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [initialize]);

  const effectiveStatus = DESIGN_PREVIEW ? "authenticated" : status;
  const anonymousAllowed =
    pathname === "/login" || pathname === "/auth/discord";

  useEffect(() => {
    if (effectiveStatus === "anonymous" && !anonymousAllowed) {
      navigate("/login", { replace: true });
    }
    if (effectiveStatus === "authenticated" && pathname === "/login") {
      navigate("/", { replace: true });
    }
  }, [pathname, navigate, effectiveStatus, anonymousAllowed]);

  if (
    effectiveStatus === "initializing" ||
    (effectiveStatus === "anonymous" && !anonymousAllowed) ||
    (effectiveStatus === "authenticated" && pathname === "/login")
  ) {
    return (
      <div
        className={`h-full w-full bg-bg-canvas ${isEdgeToEdge ? "rounded-none" : "rounded-item"}`}
      />
    );
  }

  return pathname === "/login" || pathname === "/auth/discord" ? (
    children
  ) : (
    <AppFrame>{children}</AppFrame>
  );
}

export default AuthLock;
