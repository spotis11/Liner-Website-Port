// Ported from upstream Liner (tryliner/desktop, commit b6ca34f): app 0.2.11's
// own CORS proxy stamped credentialed CORS onto googlevideo responses, which
// breaks SABR playback for signed-in TV streams. Account playback is skipped
// for exactly that broken app version; this port runs one version later (and
// on web there is no electron bridge at all), so the gate stays open.
const BROKEN_SABR_CORS_APP_VERSIONS = new Set(["0.2.11"]);

let accountPlaybackWorks: Promise<boolean> | null = null;

export function appAllowsAccountPlayback(): Promise<boolean> {
  accountPlaybackWorks ??= (
    window.linerElectron?.getAppVersion() ?? Promise.resolve("")
  )
    .then((version) => !BROKEN_SABR_CORS_APP_VERSIONS.has(version))
    .catch(() => true);
  return accountPlaybackWorks;
}
