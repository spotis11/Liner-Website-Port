import React from "react";
import ReactDOM from "react-dom/client";
// static entry import so vite emits the theme css as a real <link> in
// index.html (as a dynamic-chunk dep it never loaded — see App.tsx note)
import "./app/globals.css";
import { initGlobalErrorHandlers } from "@/shared/utils/globalErrorHandlers";
import { hydrateScreenCache } from "@/shared/cache/screenCache";
import { applyStoredTheme } from "@/shared/utils/storedTheme";
import { installWebFetchProxy } from "@/shared/lib/webProxy";
import { readPersistedUiStyleFromStorage } from "@/features/settings/store/appearanceStore";

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
  // Design switch (Settings → Appearance → App design): "original" renders
  // the frozen classic tree at @classic, "new" renders the merged upstream
  // 0.2.12 redesign in src/, "material3" renders the same src/ tree wrapped
  // in the Material 3 design layer (riff-derived tokens, M3 switch/slider,
  // ripples). Both branches are dynamic imports so the unused design never
  // lands in the initial chunk; the session and every storage key are shared,
  // so switching (with the Liner refresh prompt) keeps the user signed in.
  const uiStyle = readPersistedUiStyleFromStorage();
  const wantsNewUi = uiStyle !== "original";
  if (wantsNewUi) {
    document.documentElement.dataset.uiStyle = uiStyle;
  }
  const [
    { initMainWindowServices },
    { default: App },
    { default: RootErrorBoundary },
  ] = await Promise.all([
    wantsNewUi
      ? import("./app/mainWindowServices")
      : import("@classic/app/mainWindowServices"),
    wantsNewUi ? import("./app/App") : import("@classic/app/App"),
    wantsNewUi
      ? import("@/shared/ui/RootErrorBoundary")
      : import("@classic/shared/ui/RootErrorBoundary"),
    uiStyle === "material3"
      ? import("./material3/material3").then((m) => m.activateMaterial3())
      : Promise.resolve(),
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
