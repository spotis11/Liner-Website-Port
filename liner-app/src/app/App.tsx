import { HashRouter } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { ToastProvider, AppleEmojiProvider, RootErrorBoundary, GlobalTooltip, WindowAnimationContainer } from "@/shared/ui";
import { useWindowDrag } from "@/shared/hooks";
import { useAppIconSync } from "@/features/player";
import { I18nProvider } from "@/languages";
import { AuthLock } from "@/features/auth";
import { BanGate } from "@/features/moderation";
import { WelcomeGate } from "@/features/welcome";
import { CoverSwRegistrar } from "@/features/covers";
import { usePresenceSync } from "@/shared/presence";
import { useTouchBarSync } from "@/features/touchbar";
import { useOverlaySync } from "@/features/overlay";
import { AppRoutes } from "./routes";
import DeeplinkHandler from "./DeeplinkHandler";
import EnvironmentWarning from "./EnvironmentWarning";
import { ConnectivityWall } from "@/features/connectivity";
import { useThemeCustomizationSync, useAppearanceSync } from "@/features/settings";
import "./globals.css";

function AppIconSync() {
  useAppIconSync();
  return null;
}

function PresenceSync() {
  usePresenceSync();
  return null;
}

function ThemeSync() {
  useThemeCustomizationSync();
  return null;
}

function AppearanceSync() {
  useAppearanceSync();
  return null;
}

function TouchBarSync() {
  useTouchBarSync();
  return null;
}

function OverlaySync() {
  useOverlaySync();
  return null;
}

export default function App() {
  useWindowDrag();

  return (
    <HashRouter>
      <CoverSwRegistrar />
      <ThemeProvider
        attribute="data-theme"
        defaultTheme="system"
        enableSystem={true}
        disableTransitionOnChange
      >
        <GlobalTooltip />
        <ThemeSync />
        <AppearanceSync />
        <AppIconSync />
        <PresenceSync />
        <TouchBarSync />
        <OverlaySync />
        <AppleEmojiProvider>
          <I18nProvider>
            <ToastProvider>
              <RootErrorBoundary>
                <WindowAnimationContainer>
                  <DeeplinkHandler />
                  <EnvironmentWarning />
                  <ConnectivityWall />
                  <BanGate />
                  <WelcomeGate />
                  <AuthLock>
                    <AppRoutes />
                  </AuthLock>
                </WindowAnimationContainer>
              </RootErrorBoundary>
            </ToastProvider>
          </I18nProvider>
        </AppleEmojiProvider>
      </ThemeProvider>
    </HashRouter>
  );
}
