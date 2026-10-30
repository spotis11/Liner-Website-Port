import React from "react";
import ReactDOM from "react-dom/client";
import { initGlobalErrorHandlers } from "@/shared/utils/globalErrorHandlers";
import { installWebFetchProxy } from "@/shared/lib/webProxy";

// web port: reroute cross-origin fetches through the same-origin proxy
// before any app module gets a chance to hit the network
installWebFetchProxy();

initGlobalErrorHandlers();

const isOverlay = window.location.hash.startsWith("#/overlay");

async function loadRoot(): Promise<React.ReactElement> {
  if (isOverlay) {
    const { default: OverlayApp } = await import("./app/OverlayApp");
    return <OverlayApp />;
  }
  const [
    { initMainWindowServices },
    { default: App },
    { default: RootErrorBoundary },
  ] = await Promise.all([
    import("./app/mainWindowServices"),
    import("./app/App"),
    import("@/shared/ui/RootErrorBoundary"),
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
