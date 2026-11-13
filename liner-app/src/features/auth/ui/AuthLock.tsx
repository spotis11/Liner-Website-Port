import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { getAuthSession } from "@/shared/api";
import AppFrame from "@/features/navigation/ui/AppFrame";
import { useWindowState } from "@/features/navigation/hooks/useWindowState";

export function AuthLock({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const status = useAuthStore((state) => state.status);
  const initialize = useAuthStore((state) => state.initialize);
  // keeps the body's outer padding in step with maximize / fullscreen on every screen,
  // including login and the startup spinner (the app frame mounts its own copy too)
  const { isEdgeToEdge } = useWindowState();

  useEffect(() => {
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

  useEffect(() => {
    const anonymousAllowed = pathname === "/login" || pathname === "/auth/discord";
    if (status === "anonymous" && !anonymousAllowed) {
      navigate("/login", { replace: true });
    }
    if (status === "authenticated" && pathname === "/login") {
      navigate("/", { replace: true });
    }
  }, [pathname, navigate, status]);

  if (
    status === "initializing" ||
    (status === "anonymous" && pathname !== "/login" && pathname !== "/auth/discord") ||
    (status === "authenticated" && pathname === "/login")
  ) {
    return (
      <div
        className={`h-full w-full bg-bg-canvas ${isEdgeToEdge ? "rounded-none" : "rounded-[12px]"}`}
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
