import { HashRouter } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import {
  ToastProvider,
  AppleEmojiProvider,
  RootErrorBoundary,
  GlobalTooltip,
  WindowAnimationContainer,
} from "@classic/shared/ui";
import { useWindowDrag } from "@classic/shared/hooks";
import { useAppIconSync } from "@classic/features/player";
import { I18nProvider } from "@classic/languages";
import { AuthLock } from "@classic/features/auth";
import { BanGate } from "@classic/features/moderation";
import { MaintenanceGate } from "@classic/features/maintenance";
import { ShowcaseSync } from "@classic/features/showcase";
import { WelcomeGate } from "@classic/features/welcome";
import { CoverSwRegistrar } from "@classic/features/covers";
import { usePresenceSync } from "@classic/shared/presence";
import { useTouchBarSync } from "@classic/features/touchbar";
import { useOverlaySync } from "@classic/features/overlay";
import { useDiscordSync } from "@classic/features/discord";
import { useAiTranslatePrefetch } from "@classic/features/lyrics";
import { AppRoutes } from "./routes";
import DeeplinkHandler from "./DeeplinkHandler";
import { LikeBurstOverlay } from "@/features/player/ui/LikeBurst";
import EnvironmentWarning from "./EnvironmentWarning";
import { ConnectionIssueModal } from "@classic/features/connectivity";
import { useThemeCustomizationSync, useAppearanceSync } from "@classic/features/settings";
import { useLiquidGlassSync } from "@classic/features/liquid-glass";
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

function DiscordSync() {
  useDiscordSync();
  return null;
}

function AiTranslatePrefetch() {
  useAiTranslatePrefetch();
  return null;
}

function LiquidGlassSync() {
  useLiquidGlassSync();
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
        <LiquidGlassSync />
        <AppIconSync />
        <PresenceSync />
        <TouchBarSync />
        <OverlaySync />
        <DiscordSync />
        <AiTranslatePrefetch />
        <AppleEmojiProvider>
          <I18nProvider>
            <ToastProvider>
              <RootErrorBoundary>
                <WindowAnimationContainer>
                  {/* Mochy like burst: one full-screen canvas for the whole
                      app, so hearts fly from any like button while it is on
                      screen */}
                  <LikeBurstOverlay />
                  <DeeplinkHandler />
                  <EnvironmentWarning />
                  <ConnectionIssueModal />
                  <BanGate />
                  <MaintenanceGate />
                  <ShowcaseSync />
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
