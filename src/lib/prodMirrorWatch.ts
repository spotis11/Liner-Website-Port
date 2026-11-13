/**
 * DEV-SIDE production-mirror cache watcher — keeps the deploy-time fallback
 * chain armed without anyone remembering to re-arm it.
 *
 * The deploy build (`.zscripts/database-runtime-build.sh`) packages the live
 * production state as the seed mirror via a three-link chain:
 *   1. live fetch from the running production server (needs the CURRENT
 *      DB_MIRROR_EXPORT_KEY on both sides),
 *   2. the cached export db/production-mirror-latest.json,
 *   3. the sanitized workspace seed — which historically wiped every user
 *      account when reached (the recurring "logged out + create an account"
 *      incidents; now also gated behind DB_MIRROR_ALLOW_WIPE=1).
 *
 * Link 2 used to depend on a manual re-arm after every sandbox reset, and a
 * single forgotten re-arm meant the next deploy destroyed production state.
 * While the dev server runs, this watcher quietly refreshes that cache from
 * production every 15 minutes (and once shortly after boot), so the chain is
 * always armed with a recent production snapshot. Failures are silent —
 * production being down is normal during deploys.
 *
 * Runs ONLY outside production (the deployed container must not poll its own
 * mirror URL) and only when DB_MIRROR_EXPORT_KEY is configured.
 */

const REFRESH_INTERVAL_MS = 15 * 60_000;
const FIRST_FETCH_DELAY_MS = 20_000;
const FETCH_TIMEOUT_MS = 30_000;

let started = false;

export function startProdMirrorCacheWatcher(): void {
  if (started) return;
  if (process.env.NODE_ENV === "production") return;
  if (!process.env.DB_MIRROR_EXPORT_KEY?.trim()) return;
  started = true;

  const cachePath = process.env.DB_MIRROR_CACHE_PATH?.trim()
    || "/home/z/my-project/db/production-mirror-latest.json";
  const sourceUrl = process.env.DB_MIRROR_SOURCE_URL?.trim()
    || "https://liner-music.space-z.ai/api/db-mirror/latest";

  const refresh = async (): Promise<void> => {
    try {
      const key = process.env.DB_MIRROR_EXPORT_KEY?.trim() ?? "";
      const response = await fetch(sourceUrl, {
        headers: { "x-db-mirror-key": key, authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) return;
      const raw = await response.text();
      // never downgrade the cache with junk: same validation the build uses
      const parsed = JSON.parse(raw) as {
        savedAt?: unknown;
        tables?: Record<string, unknown[]>;
      } | null;
      const accounts = parsed?.tables?.account?.length ?? 0;
      const keys = parsed?.tables?.systemKey?.length ?? 0;
      if (typeof parsed?.savedAt !== "string" || (accounts === 0 && keys === 0)) {
        return;
      }
      const { writeFileSync } = await import("fs");
      const tmp = `${cachePath}.tmp`;
      writeFileSync(tmp, raw);
      const { renameSync } = await import("fs");
      renameSync(tmp, cachePath);
      console.log(
        `[db-mirror] cache refreshed from production (accounts ${accounts}, savedAt ${parsed.savedAt})`,
      );
    } catch {
      // production unreachable / gateway hiccup — the old cache stays valid
    }
  };

  const first = setTimeout(() => void refresh(), FIRST_FETCH_DELAY_MS);
  if (typeof first.unref === "function") first.unref();
  const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
}
