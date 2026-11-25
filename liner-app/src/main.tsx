import React from "react";
import ReactDOM from "react-dom/client";
// static entry import so vite emits the theme css as a real <link> in
// index.html (as a dynamic-chunk dep it never loaded — see App.tsx note)
import "./app/globals.css";
import { initGlobalErrorHandlers } from "@/shared/utils/globalErrorHandlers";
import { hydrateScreenCache } from "@/shared/cache/screenCache";
import { applyStoredTheme } from "@/shared/utils/storedTheme";
import { installWebFetchProxy } from "@/shared/lib/webProxy";

// web port: reroute cross-origin fetches through the same-origin proxy
// before any app module gets a chance to hit the network
installWebFetchProxy();

initGlobalErrorHandlers();

const isOverlay = window.location.hash.startsWith("#/overlay");

if (!isOverlay) applyStoredTheme();

async function loadRoot(): Promise<React.ReactElement> {
  if (isOverlay) {
    const { default: OverlayApp } = await import("./app/OverlayApp");
    return <OverlayApp />;
  }
  // Design: the New UI (the merged 0.2.12 redesign in src/) IS the app —
  // the "original" (@classic frozen tree) and "material3" designs were
  // removed by owner decision (2026-11-25): the switcher is gone, every
  // boot renders the New UI, sessions and storage keys unchanged.
  document.documentElement.dataset.uiStyle = "new";
  const [
    { initMainWindowServices },
    { default: App },
    { default: RootErrorBoundary },
  ] = await Promise.all([
    import("./app/mainWindowServices"),
    import("./app/App"),
    import("@/shared/ui/RootErrorBoundary"),
    hydrateScreenCache(),
  ]);
  initMainWindowServices();
  return (
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  );
}

const rootElement = document.getElementById("root");

if (rootElement) {
  void loadRoot().then((root) => {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>{root}</React.StrictMode>,
    );
  });
}
