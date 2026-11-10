export const DEFAULT_PRIMARY_API = "https://api.tryliner.fun";
export const SAME_ORIGIN_API = "";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isSecureBaseUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return (
      protocol === "https:" ||
      (protocol === "http:" && LOOPBACK_HOSTS.has(hostname))
    );
  } catch {
    return false;
  }
}

function isElectronContext(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as unknown as Record<string, unknown>).linerElectron)
  );
}

export function resolveApiBaseUrl(envUrl: string | undefined): string {
  const clean = envUrl?.trim().replace(/\/+$/, "");
  if (clean && isSecureBaseUrl(clean)) return clean;
  // Website port: default to same-origin. The Next.js backend serves /v1/*
  // itself (its own accounts + library, and clean error stubs instead of
  // upstream's Cloudflare bot-wall), so no browser request ever cross-origins
  // to api.tryliner.fun — nothing can be CORS-blocked any more.
  if (typeof window !== "undefined" && !isElectronContext()) {
    return SAME_ORIGIN_API;
  }
  // Electron (or non-browser contexts without a document origin) keep the
  // upstream default; the desktop shell handles CORS on its own.
  return DEFAULT_PRIMARY_API;
}

const baseUrl = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL as string | undefined,
);

export function getApiBaseUrl(): string {
  return baseUrl;
}
