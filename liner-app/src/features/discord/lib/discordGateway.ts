import type {
  DiscordConnectionStatus,
  DiscordRpcSettings,
  DiscordRpcStatePayload,
  DiscordStatusDisplayType,
} from "../contracts";
import { DEFAULT_DISCORD_SETTINGS } from "../contracts";

/**
 * Web ("self bot" style) Discord Rich Presence.
 *
 * Browsers have no Discord IPC pipe, so — like the Android app — Liner connects
 * straight to the Discord gateway over WebSocket with a user-provided token and
 * broadcasts PRESENCE_UPDATE (op 3) frames. The token never leaves this device
 * (localStorage only). This is an unofficial method: Discord may treat it as a
 * self-bot and ban the account. The UI must warn the user about this.
 *
 * Artwork: gateway presences cannot reference arbitrary external image URLs
 * directly (Discord silently drops them — unlike the desktop IPC flow, where
 * the local client registers assets on the app's behalf). Instead Liner
 * registers each cover/artist URL through Discord's external assets API
 * (POST /applications/{id}/external-assets) against a user-owned application
 * (created once, id stored in localStorage) and sends the returned signed
 * proxy path as `mp:{external_asset_path}` together with `application_id`.
 */

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const TOKEN_STORAGE_KEY = "liner_discord_rpc_token";
const APP_ID_STORAGE_KEY = "liner_discord_rpc_app_id";
const SCHEME_STORAGE_KEY = "liner_discord_rpc_auth_scheme";
const ASSET_ID_STORAGE_KEY = "liner_discord_rpc_assets_v1";

// Discord REST is relayed through Liner's server (same-origin route) because
// bot-scheme auth requires a User-Agent browsers cannot send.
const RELAY_BASE = "/api/discord/";
const ASSET_UPLOAD_BASE = "/api/discord-asset";

// Discord caches external assets server-side for ~4h; refresh ours a bit earlier.
const ASSET_CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const ASSET_CACHE_MAX_ENTRIES = 200;
const ASSET_ID_CACHE_MAX_ENTRIES = 300;

const SYNC_DEBOUNCE_MS = 1_000;
// Discord gateway presence updates are limited to ~5 per minute per connection.
const MIN_SYNC_INTERVAL_MS = 12_500;
// A real content change (new track, play/pause, new artwork) must land fast —
// waiting out the full rate-limit window made every track switch show up on
// Discord 5-12s late. Content changes flush after this floor; minor updates
// (seek re-anchor, late avatar load) keep the conservative window above.
const CONTENT_SYNC_FLOOR_MS = 5_000;
const CONTENT_SYNC_DEBOUNCE_MS = 250;
const RECONNECT_INTERVAL_MS = 5_000;
const MAX_IMAGE_URL_LENGTH = 256;

const MAX_TEXT_LENGTH = 128;

export type GatewayActivityAssets = {
  large_image?: string;
  large_text?: string;
  small_image?: string;
  small_text?: string;
};

export type GatewayActivity = {
  name: string;
  type: number;
  application_id?: string;
  status_display_type?: number;
  details?: string;
  state?: string;
  timestamps?: { start: number; end: number };
  assets?: GatewayActivityAssets;
};

/** Resolves a possibly-relative app URL to an absolute https URL Discord can fetch. */
export function absolutizeHttpUrl(
  url: string | undefined | null,
  origin: string,
): string | undefined {
  if (!url) return undefined;
  try {
    const resolved = new URL(url, origin);
    return resolved.protocol === "https:" ? resolved.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Discord only accepts absolute https image URLs up to 256 chars. */
export function toDiscordImageUrl(url: string | undefined): string | undefined {
  if (!url || url.length > MAX_IMAGE_URL_LENGTH) return undefined;
  try {
    return new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Discord renders `mp:` assets hosted on its own CDN without registration
 * (mirrors the official client's parseImage mapping). Everything else must go
 * through the external assets API. Returns the direct asset key, or undefined
 * when the URL needs registration.
 */
export function toDirectAssetKey(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname === "cdn.discordapp.com" ||
      parsed.hostname === "media.discordapp.net"
    ) {
      return "mp:" + parsed.pathname.replace(/^\//, "") + parsed.search;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function sanitizeText(
  text: string | undefined | null,
  maxLen = MAX_TEXT_LENGTH,
): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.length === 1) return trimmed + " ";
  return trimmed.slice(0, maxLen);
}

function statusDisplayTypeValue(type: DiscordStatusDisplayType): number {
  // Mirror the Electron mapping:
  // 0 (NAME) -> "Listening to Liner", 1 (STATE) -> "Listening to [state]",
  // 2 (DETAILS) -> "Listening to [details]"
  switch (type) {
    case "app":
      return 0;
    case "title":
    case "title_artist":
      return 2;
    case "artist":
    case "artist_title":
    default:
      return 1;
  }
}

/**
 * Identifies the content a presence frame would display. A change here (new
 * track, play/pause, artwork url) is worth flushing the send immediately;
 * unchanged content (seek ticks) can wait out the rate-limit window.
 */
export function activityFingerprint(payload: DiscordRpcStatePayload | null): string {
  if (!payload || !payload.track) return "idle";
  const track = payload.track;
  return [
    payload.status,
    track.id ?? "",
    track.title ?? "",
    track.artist ?? "",
    track.coverUrl ?? "",
    payload.artistImageUrl ?? "",
  ].join("\u0000");
}

/**
 * Pure activity builder — mirrors electron/discord.ts syncActivity() 1:1,
 * adapted to gateway JSON (snake_case fields, ms timestamps, mp: image prefix).
 */
export function buildPresenceActivity(
  payload: DiscordRpcStatePayload,
  settings: DiscordRpcSettings,
  now: number = Date.now(),
  payloadReceivedAt: number = now,
): GatewayActivity | null {
  if (!settings.enabled) return null;
  if (!payload || !payload.track || payload.status === "idle" || payload.status === "error") {
    return null;
  }

  const isPlaying = payload.status === "playing";
  const isPaused = payload.status === "paused";

  if (isPaused && !settings.showPaused) return null;

  const track = payload.track;
  const title = sanitizeText(track.title) || "Unknown Title";
  const artist = sanitizeText(track.artist) || "Unknown Artist";

  const dur = Math.max(0, payload.durationMs || track.durationMs || 0);

  let activityName = "Liner";
  let detailsText = title;
  let stateText = isPaused ? `${artist} (Paused)` : artist;

  switch (settings.statusDisplayType) {
    case "title":
      activityName = title;
      detailsText = isPaused ? `${title} (Paused)` : title;
      stateText = artist;
      break;
    case "app":
      activityName = "Liner";
      detailsText = title;
      stateText = isPaused ? `${artist} (Paused)` : artist;
      break;
    case "artist_title":
      activityName = `${artist} - ${title}`;
      detailsText = title;
      stateText = isPaused ? `${artist} - ${title} (Paused)` : `${artist} - ${title}`;
      break;
    case "title_artist":
      activityName = `${title} - ${artist}`;
      detailsText = isPaused ? `${title} - ${artist} (Paused)` : `${title} - ${artist}`;
      stateText = artist;
      break;
    case "artist":
    default:
      activityName = artist;
      detailsText = title;
      stateText = isPaused ? `${artist} (Paused)` : artist;
      break;
  }

  const activity: GatewayActivity = {
    name: sanitizeText(activityName) || "Liner",
    type: 2, // 2 = LISTENING -> renders "Listening to ..." + live progress bar
    status_display_type: statusDisplayTypeValue(settings.statusDisplayType),
    details: sanitizeText(detailsText),
    state: sanitizeText(stateText),
  };

  // Live progress bar (only while playing, like the desktop app)
  if (isPlaying && settings.showTime && dur > 0) {
    const elapsedSincePayload = Math.max(0, now - (payloadReceivedAt || now));
    const currentPos = Math.min(dur, Math.max(0, (payload.positionMs || 0) + elapsedSincePayload));
    activity.timestamps = {
      start: now - currentPos,
      end: now - currentPos + dur,
    };
  }

  // Large artwork (album/track cover). External images need the "mp:" prefix
  // for the gateway to render them.
  const coverImage = toDiscordImageUrl(track.coverUrl);
  if (settings.showArtwork && coverImage) {
    activity.assets = {
      ...activity.assets,
      large_image: `mp:${coverImage}`,
      large_text: sanitizeText(track.album || track.title) || "Liner",
    };
  }

  // Small artwork (artist photo badge)
  const artistImage = toDiscordImageUrl(payload.artistImageUrl);
  if (settings.showArtistSmallImage && artistImage) {
    activity.assets = {
      ...activity.assets,
      small_image: `mp:${artistImage}`,
      small_text: sanitizeText(track.artist) || "Artist",
    };
  }

  return activity;
}

export interface DiscordGatewayStatus extends DiscordConnectionStatus {
  connecting: boolean;
  error: string | null;
}

const OFFLINE_STATUS: DiscordGatewayStatus = {
  connected: false,
  connecting: false,
  error: null,
};

function readStoredToken(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // storage unavailable (private mode etc.) — stay in-memory only
  }
}

function readStoredAppId(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const id = localStorage.getItem(APP_ID_STORAGE_KEY);
    return id && /^[0-9]{17,19}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function storeAppId(id: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (id) localStorage.setItem(APP_ID_STORAGE_KEY, id);
    else localStorage.removeItem(APP_ID_STORAGE_KEY);
  } catch {
    // storage unavailable — the app is simply re-created next session
  }
}

interface ExternalAssetEntry {
  url?: string;
  external_asset_path?: string;
}

type AuthScheme = "bot" | "user";

function readStoredAuthScheme(): AuthScheme | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const value = localStorage.getItem(SCHEME_STORAGE_KEY);
    return value === "bot" || value === "user" ? value : null;
  } catch {
    return null;
  }
}

function storeAuthScheme(scheme: AuthScheme | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (scheme) localStorage.setItem(SCHEME_STORAGE_KEY, scheme);
    else localStorage.removeItem(SCHEME_STORAGE_KEY);
  } catch {
    // storage unavailable — scheme is simply re-detected next session
  }
}

type AssetIdCache = Record<string, { asset_id: string; at: number }>;

function readAssetIdCache(): AssetIdCache {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(ASSET_ID_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as AssetIdCache;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function storeAssetIdCache(cache: AssetIdCache): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(ASSET_ID_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // storage unavailable — uploads re-run next session
  }
}

/** Small stable string hash (djb2) for asset keys. */
function assetKeyHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36) + input.length.toString(36);
}

class DiscordGatewayClient {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private settings: DiscordRpcSettings = { ...DEFAULT_DISCORD_SETTINGS };
  private latestPayload: DiscordRpcStatePayload | null = null;
  private latestPayloadAt = 0;
  private status: DiscordGatewayStatus = { ...OFFLINE_STATUS };
  private listeners = new Set<(status: DiscordGatewayStatus) => void>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSyncAt = 0;
  /** fingerprint of the activity content that actually went out last */
  private lastSentFingerprint: string | null = null;
  private seq: number | null = null;
  private manualDisconnect = false;
  private applicationId: string | null = null;
  private ensureAppPromise: Promise<string | null> | null = null;
  private assetPathCache = new Map<string, { path: string; at: number }>();
  /** per-url in-flight external-assets registrations (dedupe prewarm vs send) */
  private assetRegistrationJobs = new Map<string, Promise<string | null>>();
  /** per-url in-flight application-asset uploads (dedupe prewarm vs send) */
  private assetUploadJobs = new Map<string, Promise<string | null>>();
  private syncing = false;
  private authScheme: AuthScheme | null = null;
  private ensureSchemePromise: Promise<AuthScheme | null> | null = null;
  private gatewayUserId: string | null = null;
  private assetIdCache: AssetIdCache = readAssetIdCache();

  constructor() {
    this.token = readStoredToken();
    this.applicationId = readStoredAppId();
    this.authScheme = readStoredAuthScheme();
    if (this.token && typeof WebSocket !== "undefined") {
      // Auto-connect with the saved token (mirrors "token automatically saved" on mobile)
      this.open();
    }
  }

  public hasStoredToken(): boolean {
    return Boolean(this.token || readStoredToken());
  }

  public getStatus(): DiscordGatewayStatus {
    return this.status;
  }

  public subscribe(listener: (status: DiscordGatewayStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public connect(token: string): void {
    const trimmed = token.trim();
    if (!trimmed) return;
    this.token = trimmed;
    storeToken(trimmed);
    this.manualDisconnect = false;
    // Token changed — reset all derived auth state
    this.authScheme = null;
    this.ensureSchemePromise = null;
    this.gatewayUserId = null;
    this.applicationId = null;
    this.ensureAppPromise = null;
    this.lastSentFingerprint = null;
    storeAuthScheme(null);
    this.setStatus({ ...OFFLINE_STATUS, connecting: true });
    this.open();
  }

  public disconnect(): void {
    this.manualDisconnect = true;
    this.token = null;
    storeToken(null);
    this.latestPayload = null;
    this.applicationId = null;
    this.ensureAppPromise = null;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closeSocket();
    this.setStatus({ ...OFFLINE_STATUS });
  }

  public updateSettings(settings: DiscordRpcSettings): void {
    const prevEnabled = this.settings.enabled;
    this.settings = { ...settings };
    if (prevEnabled !== settings.enabled && !settings.enabled) {
      // Toggle off -> drop the activity but keep the gateway session alive
      this.scheduleSync(0);
      return;
    }
    if (this.status.connected) {
      this.scheduleSync(0);
    }
  }

  public pushState(payload: DiscordRpcStatePayload): void {
    const fingerprint = activityFingerprint(payload);
    this.latestPayload = payload;
    this.latestPayloadAt = Date.now();
    if (!this.status.connected) return;

    if (fingerprint !== this.lastSentFingerprint) {
      // Content change — new track, play/pause or new artwork. Warm the
      // asset registration in parallel (so the throttled send never pays
      // the registration round trips) and flush fast instead of waiting
      // out the full rate-limit window.
      void this.prewarmAssets();
      this.scheduleSync(
        Math.max(
          CONTENT_SYNC_DEBOUNCE_MS,
          CONTENT_SYNC_FLOOR_MS - (Date.now() - this.lastSyncAt),
        ),
      );
      return;
    }
    this.scheduleSync();
  }

  // --- internals -----------------------------------------------------------

  /** Minimal REST call relayed through Liner's server using the stored token. */
  private async apiFetch<T = unknown>(
    method: "POST" | "PUT" | "GET" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<{ data: T | null; scheme: AuthScheme | null }> {
    if (!this.token) return { data: null, scheme: null };
    try {
      const headers: Record<string, string> = { "x-liner-token": this.token };
      if (this.authScheme) headers["x-liner-scheme"] = this.authScheme;
      const res = await fetch(RELAY_BASE + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const schemeHeader = res.headers.get("x-liner-auth-scheme");
      const scheme: AuthScheme | null =
        schemeHeader === "bot" || schemeHeader === "user" ? schemeHeader : null;
      if (scheme && scheme !== this.authScheme) {
        this.authScheme = scheme;
        storeAuthScheme(scheme);
      }
      if (!res.ok) return { data: null, scheme };
      return { data: (await res.json()) as T, scheme };
    } catch {
      return { data: null, scheme: null };
    }
  }

  /**
   * Detect whether the stored token is a bot or user token. The relay tries
   * bot-scheme auth first and falls back to user auth; the resolved scheme
   * comes back on every response and is persisted to skip future retries.
   */
  private ensureAuthScheme(): Promise<AuthScheme | null> {
    if (this.authScheme) return Promise.resolve(this.authScheme);
    if (this.ensureSchemePromise) return this.ensureSchemePromise;
    this.ensureSchemePromise = (async () => {
      const { scheme } = await this.apiFetch<{ id?: string; bot?: boolean }>(
        "GET",
        "users/@me",
      );
      this.authScheme = scheme;
      return scheme;
    })();
    return this.ensureSchemePromise;
  }

  /**
   * Resolve the application id used for artwork. Bot tokens use their own
   * application (id == bot user id); user tokens lazily create a user-owned
   * application once and persist the id.
   */
  private async ensureApplicationId(): Promise<string | null> {
    if (this.applicationId) return this.applicationId;
    const scheme = await this.ensureAuthScheme();
    if (!scheme) return null;

    if (scheme === "bot") {
      // A bot's application id equals its user id (confirmed via
      // /oauth2/applications/@me). READY gives us the user id for free.
      this.applicationId = this.gatewayUserId;
      return this.applicationId;
    }

    if (this.ensureAppPromise) return this.ensureAppPromise;
    this.ensureAppPromise = (async () => {
      let id = readStoredAppId();
      if (!id) {
        const { data: created } = await this.apiFetch<{ id?: string }>(
          "POST",
          "applications",
          { name: "Liner" },
        );
        id = created && typeof created.id === "string" ? created.id : null;
        if (id) storeAppId(id);
      }
      this.applicationId = id;
      return id;
    })();
    return this.ensureAppPromise;
  }

  private cacheAssetPath(url: string, path: string): void {
    if (this.assetPathCache.size >= ASSET_CACHE_MAX_ENTRIES) {
      // Drop the oldest entry to keep the cache bounded
      const oldest = this.assetPathCache.keys().next().value;
      if (oldest !== undefined) this.assetPathCache.delete(oldest);
    }
    this.assetPathCache.set(url, { path, at: Date.now() });
  }

  /**
   * Register artwork URLs with Discord's external assets API (user tokens
   * only — bot auth is rejected with 20001) and return a url -> signed proxy
   * path map. Self-heals by re-creating the application when the id is stale.
   */
  private async registerExternalAssets(
    urls: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (!urls.length) return result;

    const now = Date.now();
    const missing: string[] = [];
    for (const url of urls) {
      const hit = this.assetPathCache.get(url);
      if (hit && now - hit.at < ASSET_CACHE_TTL_MS) result.set(url, hit.path);
      else missing.push(url);
    }
    if (!missing.length) return result;

    let appId = await this.ensureApplicationId();
    if (!appId) return result;

    let res = (
      await this.apiFetch<ExternalAssetEntry[]>(
        "POST",
        `applications/${appId}/external-assets`,
        { urls: missing },
      )
    ).data;
    if (!res) {
      // The stored application may have been deleted — recreate once and retry
      storeAppId(null);
      this.applicationId = null;
      this.ensureAppPromise = null;
      const freshId = await this.ensureApplicationId();
      if (freshId && freshId !== appId) {
        appId = freshId;
        res = (
          await this.apiFetch<ExternalAssetEntry[]>(
            "POST",
            `applications/${appId}/external-assets`,
            { urls: missing },
          )
        ).data;
      }
    }

    if (Array.isArray(res)) {
      for (const entry of res) {
        if (
          entry &&
          typeof entry.url === "string" &&
          typeof entry.external_asset_path === "string" &&
          entry.external_asset_path
        ) {
          this.cacheAssetPath(entry.url, entry.external_asset_path);
          result.set(entry.url, entry.external_asset_path);
        }
      }
    }
    return result;
  }

  private cacheAssetId(url: string, assetId: string): void {
    this.assetIdCache[url] = { asset_id: assetId, at: Date.now() };
    const entries = Object.entries(this.assetIdCache);
    if (entries.length > ASSET_ID_CACHE_MAX_ENTRIES) {
      entries.sort((a, b) => a[1].at - b[1].at);
      const next: AssetIdCache = {};
      for (const [key, value] of entries.slice(entries.length - ASSET_ID_CACHE_MAX_ENTRIES)) {
        next[key] = value;
      }
      this.assetIdCache = next;
    }
    storeAssetIdCache(this.assetIdCache);
  }

  /**
   * Resolve artwork into Discord application asset ids (bot tokens — the
   * external-assets endpoint rejects bot auth). Uploads once per unique url
   * through Liner's relay and caches ids permanently: the assets persist
   * server-side, so replaying a cached id costs no request at all.
   */
  private async resolveBotAssetIds(urls: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (!urls.length) return result;

    const appId = await this.ensureApplicationId();
    if (!appId || !this.token) return result;

    const missing: string[] = [];
    for (const url of urls) {
      const cached = this.assetIdCache[url];
      if (cached?.asset_id) result.set(url, cached.asset_id);
      else missing.push(url);
    }
    if (!missing.length) return result;

    const uploads: Array<Promise<void>> = [];
    for (const url of missing) {
      uploads.push(
        (async () => {
          try {
            const res = await fetch(ASSET_UPLOAD_BASE, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                token: this.token,
                appId,
                url,
                key: `c${assetKeyHash(url)}`,
                scheme: this.authScheme ?? "bot",
              }),
            });
            if (!res.ok) return;
            const data = (await res.json()) as { asset_id?: string };
            if (data.asset_id) {
              this.cacheAssetId(url, data.asset_id);
              result.set(url, data.asset_id);
            }
          } catch {
            // artwork is best-effort — presence continues without it
          }
        })(),
      );
    }
    await Promise.all(uploads);
    return result;
  }

  /**
   * Resolve one artwork url through the external-assets API (user tokens),
   * deduplicating concurrent callers (prewarm vs actual send) with a shared
   * in-flight job per url.
   */
  private async resolveUserAssetKey(url: string): Promise<string | null> {
    const cached = this.assetPathCache.get(url);
    if (cached && Date.now() - cached.at < ASSET_CACHE_TTL_MS) return cached.path;
    const job = this.assetRegistrationJobs.get(url);
    if (job) return job;
    const run = (async () => {
      const map = await this.registerExternalAssets([url]);
      return map.get(url) ?? null;
    })().finally(() => {
      this.assetRegistrationJobs.delete(url);
    });
    this.assetRegistrationJobs.set(url, run);
    return run;
  }

  /**
   * Resolve one artwork url by uploading it as an application asset (works
   * for bot tokens and, via the relay's user-scheme support, user tokens).
   */
  private async resolveUploadedAssetKey(url: string): Promise<string | null> {
    const cached = this.assetIdCache[url];
    if (cached?.asset_id) return cached.asset_id;
    const job = this.assetUploadJobs.get(url);
    if (job) return job;
    const run = (async () => {
      const map = await this.resolveBotAssetIds([url]);
      return map.get(url) ?? null;
    })().finally(() => {
      this.assetUploadJobs.delete(url);
    });
    this.assetUploadJobs.set(url, run);
    return run;
  }

  /**
   * Register the current track's artwork urls ahead of the throttled send:
   * builds the activity the same way the send path will, runs the asset
   * resolution now and lets the caches fill while the debounce window
   * elapses. The send then resolves its keys from cache instead of paying
   * the relay round trips inside the presence path. Fire-and-forget.
   */
  private prewarmAssets(): void {
    if (!this.settings.enabled || !this.latestPayload) return;
    const activity = buildPresenceActivity(
      this.latestPayload,
      this.settings,
      Date.now(),
      this.latestPayloadAt,
    );
    if (!activity?.assets) return;
    void this.attachExternalAssets(activity).catch(() => {
      // artwork is best-effort — the send path retries with the same caches
    });
  }

  /**
   * Resolve every raw image url into a key Discord actually renders:
   * - Discord CDN urls map directly (both token kinds);
   * - user tokens register external urls via the external assets API
   *   (`mp:{signed proxy path}`);
   * - anything still unresolved falls back to uploading the image as an
   *   application asset — Discord rejects external-assets for some
   *   accounts/applications, and without this second chance those users
   *   never saw a single cover.
   */
  private async attachExternalAssets(activity: GatewayActivity): Promise<void> {
    const assets = activity.assets;
    if (!assets) {
      if (this.applicationId) activity.application_id = this.applicationId;
      return;
    }

    const rawUrls: string[] = [];
    if (assets.large_image?.startsWith("mp:")) rawUrls.push(assets.large_image.slice(3));
    if (assets.small_image?.startsWith("mp:")) rawUrls.push(assets.small_image.slice(3));

    const resolved = new Map<string, string>();
    await Promise.all(
      rawUrls.map(async (url) => {
        const direct = toDirectAssetKey(url);
        if (direct) {
          resolved.set(url, direct);
          return;
        }
        const scheme = (await this.ensureAuthScheme()) ?? null;
        if (scheme === "user") {
          const registered = await this.resolveUserAssetKey(url);
          if (registered) {
            resolved.set(url, registered);
            return;
          }
        }
        const uploaded = await this.resolveUploadedAssetKey(url);
        if (uploaded) resolved.set(url, uploaded);
      }),
    );

    const next: GatewayActivityAssets = {};
    if (assets.large_text) next.large_text = assets.large_text;
    if (assets.small_text) next.small_text = assets.small_text;
    if (assets.large_image) {
      const key = resolved.get(assets.large_image.slice(3));
      if (key) next.large_image = key;
    }
    if (assets.small_image) {
      const key = resolved.get(assets.small_image.slice(3));
      if (key) next.small_image = key;
    }
    if (next.large_image || next.small_image) activity.assets = next;
    else delete activity.assets;

    if (this.applicationId) activity.application_id = this.applicationId;
  }

  private setStatus(next: DiscordGatewayStatus): void {
    this.status = next;
    for (const listener of this.listeners) {
      try {
        listener(next);
      } catch {
        // listener errors must never break the socket loop
      }
    }
  }

  private open(): void {
    if (typeof WebSocket === "undefined") return; // tests / SSR
    this.closeSocket();
    if (!this.token) return;

    let socket: WebSocket;
    try {
      socket = new WebSocket(GATEWAY_URL);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.addEventListener("message", (event) => {
      if (socket !== this.ws) return;
      try {
        const parsed = JSON.parse(String(event.data));
        this.handlePayload(parsed);
      } catch {
        // malformed frame — ignore
      }
    });
    socket.addEventListener("close", (event) => {
      if (socket !== this.ws) return;
      this.handleClose(event.code);
    });
    socket.addEventListener("error", () => {
      // "close" always follows; nothing to do here
    });
  }

  private closeSocket(): void {
    const socket = this.ws;
    this.ws = null;
    if (!socket) return;
    try {
      socket.close(1000);
    } catch {
      // already closing/closed
    }
  }

  private handleClose(code: number): void {
    this.stopHeartbeat();
    this.ws = null;

    if (this.manualDisconnect || !this.token) {
      this.setStatus({ ...OFFLINE_STATUS });
      return;
    }

    if (code === 4004) {
      // Authentication failed — retrying is pointless
      this.setStatus({
        connected: false,
        connecting: false,
        error:
          "Invalid token — Discord closed the connection (4004). Check the token and try again.",
      });
      return;
    }

    this.setStatus({
      connected: false,
      connecting: true,
      error: null,
    });
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.token || this.manualDisconnect) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.token && !this.manualDisconnect && !this.ws) {
        this.open();
      }
    }, RECONNECT_INTERVAL_MS);
  }

  private handlePayload(payload: {
    op: number;
    s?: number;
    t?: string;
    d?: any;
  }): void {
    if (typeof payload.s === "number") {
      this.seq = payload.s;
    }

    switch (payload.op) {
      case 10: {
        // HELLO
        const interval = payload.d?.heartbeat_interval ?? 41_250;
        this.startHeartbeat(interval);
        this.identify();
        break;
      }
      case 0: {
        if (payload.t === "READY") {
          const user = payload.d?.user;
          if (user?.id) this.gatewayUserId = String(user.id);
          this.setStatus({
            connected: true,
            connecting: false,
            error: null,
            username: user?.username,
            avatarUrl: user?.avatar
              ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
              : user?.id
                ? "https://cdn.discordapp.com/embed/avatars/0.png"
                : undefined,
          });
          // Re-apply the latest playback state on (re)connect
          this.lastSyncAt = 0;
          if (this.latestPayload) {
            this.scheduleSync(0);
          }
        }
        break;
      }
      case 9: {
        // Invalid session — server asks us to re-identify
        setTimeout(() => {
          if (this.token && !this.manualDisconnect) this.identify();
        }, 2_000);
        break;
      }
      case 7: {
        // Server requested reconnect
        this.closeSocket();
        break;
      }
      default:
        break; // 11 = heartbeat ACK
    }
  }

  private identify(): void {
    if (!this.token) return;
    this.send({
      op: 2,
      d: {
        token: this.token,
        intents: 0,
        properties: {
          os: "windows",
          browser: "Chrome",
          device: "Chrome",
        },
      },
    });
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ op: 1, d: this.seq });
      }
    }, Math.max(5_000, intervalMs));
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleSync(delay?: number): void {
    // A pending send already carries the latest payload when it fires — a
    // minor update (seek tick) must never push a pending fast content send
    // further out.
    if (delay === undefined && this.syncTimer) return;
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    const wait =
      delay ??
      Math.max(SYNC_DEBOUNCE_MS, MIN_SYNC_INTERVAL_MS - (Date.now() - this.lastSyncAt));
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.lastSyncAt = Date.now();
      this.sendPresence();
    }, wait);
  }

  private sendPresence(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.status.connected) {
      return;
    }
    if (this.syncing) {
      // An async asset registration is still in flight — try again shortly
      this.scheduleSync(1_000);
      return;
    }
    this.syncing = true;
    void this.doSendPresence().finally(() => {
      this.syncing = false;
    });
  }

  private async doSendPresence(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.status.connected) {
      return;
    }
    let activities: GatewayActivity[] = [];
    if (this.latestPayload && this.settings.enabled) {
      const activity = buildPresenceActivity(
        this.latestPayload,
        this.settings,
        Date.now(),
        this.latestPayloadAt,
      );
      if (activity) {
        await this.attachExternalAssets(activity);
        activities = [activity];
      }
    }
    this.lastSentFingerprint = activityFingerprint(this.latestPayload);
    this.send({
      op: 3,
      d: {
        since: null,
        activities,
        status: "online",
        afk: false,
      },
    });
  }

  private send(frame: unknown): void {
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(frame));
    } catch {
      // frame dropped; heartbeat/reconnect handles the fallout
    }
  }
}

export const discordGateway = new DiscordGatewayClient();
