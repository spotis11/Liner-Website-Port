// signs outgoing api requests with canonical headers: x-liner-signature, timestamp, nonce
export interface SignedHeaders {
  "x-liner-signature"?: string;
  "x-liner-timestamp"?: string;
  "x-liner-nonce"?: string;
}

// maintains clock delta between client and server (ms)
let serverTimeOffsetMs = 0;

// parses date header from server response and calculates clock delta
export function syncServerTime(dateHeaderOrMs: string | number | Date): number {
  const serverMs =
    typeof dateHeaderOrMs === "number"
      ? dateHeaderOrMs
      : typeof dateHeaderOrMs === "string"
        ? Date.parse(dateHeaderOrMs)
        : dateHeaderOrMs.getTime();

  if (!Number.isNaN(serverMs) && serverMs > 0) {
    serverTimeOffsetMs = serverMs - Date.now();
    // notify electron main process to sync its native signer clock
    if (typeof window !== "undefined" && window.linerElectron?.syncServerTime) {
      window.linerElectron.syncServerTime(serverMs).catch(() => {});
    }
  }
  return serverTimeOffsetMs;
}

export function getServerTimeOffset(): number {
  return serverTimeOffsetMs;
}

export function getAdjustedTimestamp(): number {
  return Math.floor((Date.now() + serverTimeOffsetMs) / 1000);
}

function isElectron(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.linerElectron?.signRequest === "function"
  );
}

// ---- browser fallback signer ------------------------------------------------
// The desktop signs with its native/WASM signer over IPC. The website port
// has no Electron bridge, so it signs with the exact same scheme in pure
// WebCrypto — key derivation from the official public constants (identical to
// linerSession.ts), canonical string METHOD\npath\nts\nnonce\nsha256(body),
// HMAC-SHA256, base64url. Verified to pass the upstream's signature check
// through the same-origin relay (v1.24 word-level lyrics relay uses it).

const OBF_API_SEED = Uint8Array.from([
  0x55, 0xc3, 0x5c, 0xaa, 0x3f, 0x3c, 0x32, 0x6d, 0xaa, 0x63, 0x0f, 0x90,
  0x39, 0x5d, 0x66, 0x36,
]);
const OBF_API_KEY = Uint8Array.from([
  0x24, 0x99, 0x56, 0x2b, 0x80, 0x20, 0xc1, 0xb7, 0xf6, 0x7d, 0x74, 0x91,
  0xe4, 0xc3, 0x7f, 0x67, 0x1a, 0x0e, 0x8a, 0xf3, 0x7f, 0x50, 0xaf, 0x2e,
  0x05, 0xd5, 0xa7, 0xb0, 0xbe, 0x6e, 0x31, 0x11, 0x40, 0xf3, 0x42, 0xad,
  0x31, 0xf6, 0xcb, 0xea, 0xb5, 0xba, 0xdd, 0xd0, 0x8e, 0x56, 0x55, 0x8c,
  0xb4, 0xe5, 0x1d, 0x82, 0x69, 0x0c, 0x3f, 0xb2, 0x30, 0x82, 0xa7, 0xf4,
  0x9b, 0xba, 0x9b, 0x70,
]);
const API_KEY_CHECKSUM = Uint8Array.from([
  0xe2, 0x09, 0x02, 0x55, 0x83, 0xee, 0xf0, 0x07,
]);

let browserSignerKey: CryptoKey | null = null;

function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function deriveBrowserSignerKey(): Promise<CryptoKey> {
  if (browserSignerKey) return browserSignerKey;
  let ks = new Uint8Array(0);
  for (let i = 0; ks.length < 64; i = (i + 1) & 0xff) {
    const block = await sha256Bytes(concatBytes(OBF_API_SEED, Uint8Array.of(i)));
    ks = concatBytes(ks, block);
  }
  const key = new Uint8Array(64);
  for (let idx = 0; idx < 64; idx++) key[idx] = OBF_API_KEY[idx] ^ ks[idx];
  const digest = await sha256Bytes(key);
  for (let idx = 0; idx < 8; idx++) {
    if (digest[idx] !== API_KEY_CHECKSUM[idx]) {
      throw new Error("liner signer key derivation failed");
    }
  }
  browserSignerKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return browserSignerKey;
}

/** WebCrypto implementation of the desktop's request signature (web port). */
async function signInBrowser(
  method: string,
  path: string,
  body?: string | null,
  customTimestamp?: number,
): Promise<SignedHeaders> {
  try {
    const key = await deriveBrowserSignerKey();
    const timestamp = customTimestamp ?? getAdjustedTimestamp();
    const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(8)));
    const bodySha = await sha256Bytes(
      new TextEncoder().encode(body ?? ""),
    );
    const canonical = `${method.toUpperCase().trim()}\n${path.split("?")[0].trim()}\n${timestamp}\n${nonce}\n${Array.from(bodySha)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}`;
    const mac = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(canonical) as Uint8Array<ArrayBuffer>,
    );
    return {
      "x-liner-signature": bytesToBase64Url(new Uint8Array(mac)),
      "x-liner-timestamp": String(timestamp),
      "x-liner-nonce": nonce,
    };
  } catch {
    // an unsigned request is better than a broken one
    return {};
  }
}

export async function signApiRequest(
  method: string,
  path: string,
  body?: string | null,
  customTimestamp?: number,
): Promise<SignedHeaders> {
  if (!isElectron()) {
    // website port: sign with WebCrypto (same scheme/keys as the native signer)
    return signInBrowser(method, path, body, customTimestamp);
  }

  const cleanPath = path.split("?")[0].trim();
  const timestamp = customTimestamp ?? getAdjustedTimestamp();

  try {
    const res = await window.linerElectron!.signRequest({
      method: method.toUpperCase().trim(),
      path: cleanPath,
      body: body ?? undefined,
      timestamp,
    });

    if (res && res.error) {
      console.error("[Signer] Native signer error:", res.error);
    } else if (res && res.signature) {
      return {
        "x-liner-signature": res.signature,
        "x-liner-timestamp": String(res.timestamp ?? timestamp),
        "x-liner-nonce": res.nonce,
      };
    }
  } catch (err) {
    console.error("[Signer] IPC signRequest call failed:", err);
  }

  return {};
}
