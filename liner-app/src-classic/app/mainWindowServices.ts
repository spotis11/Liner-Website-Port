import { initTelemetry } from "@classic/shared/telemetry";
import { initBackgroundStorageAnalytics } from "@classic/shared/utils/cacheManager";
import { initClientVisitorSession } from "@classic/shared/youtube";
import { initBundleStampLog } from "@classic/shared/utils/bundleStampLog";
import { initSavedTracks } from "@classic/features/library/saved";
import { initOfflineMode } from "@classic/features/connectivity/engine/offlineController";

export function initMainWindowServices() {
  initTelemetry();
  initBackgroundStorageAnalytics();
  initClientVisitorSession();
  initBundleStampLog();
  initOfflineMode();
  initSavedTracks();
}
