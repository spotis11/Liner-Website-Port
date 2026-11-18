import { ThemeProvider } from "next-themes";
import GlobalTooltip from "@classic/shared/ui/GlobalTooltip";
import { OverlayPlayer } from "@classic/features/overlay/ui/OverlayPlayer";
import { getAuthSession } from "@classic/shared/api/auth-session";
import "./globals.css";

export default function OverlayApp() {
  if (!getAuthSession()) {
    window.linerElectron?.closeOverlay?.();
    return null;
  }

  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="dark"
      enableSystem={false}
      forcedTheme="dark"
    >
      <GlobalTooltip />
      <OverlayPlayer />
    </ThemeProvider>
  );
}
