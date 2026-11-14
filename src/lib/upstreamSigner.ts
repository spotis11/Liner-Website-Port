// Server-side signer for the relay's OWN upstream calls (api.tryliner.fun).
//
// The browser signs every /v1 request it sends through the relay (the
// signature covers METHOD\npath\nts\nnonce\nsha256(body) with the official
// public constants — see liner-app/src/shared/api/requestSigner.ts). The
// relay forwards those headers byte-for-byte, so browser-signed requests
// stay valid. But when the RELAY itself needs to make an upstream call
// outside the browser's request (e.g. the GET /v1/me validation hop for the
// local upstream-profile patch, where the browser signed the PATCH path —
// not the GET), it must sign that call itself with the same scheme or the
// upstream rejects it.
import crypto from "node:crypto";

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

let cachedKey: Buffer | null = null;

function deriveKey(): Buffer {
  if (cachedKey) return cachedKey;
  const blocks: Buffer[] = [];
  const seed = Buffer.from(OBF_API_SEED);
  let ks = Buffer.alloc(0);
  for (let i = 0; ks.length < 64; i = (i + 1) & 0xff) {
    ks = Buffer.concat([ks, crypto.createHash("sha256").update(Buffer.concat([seed, Buffer.of(i)])).digest()]);
  }
  const key = Buffer.alloc(64);
  for (let idx = 0; idx < 64; idx++) key[idx] = OBF_API_KEY[idx] ^ ks[idx];
  const digest = crypto.createHash("sha256").update(key).digest();
  if (!digest.subarray(0, 8).equals(Buffer.from(API_KEY_CHECKSUM))) {
    throw new Error("liner signer key derivation failed");
  }
  cachedKey = key;
  return key;
}

function toBase64Url(bytes: Buffer): string {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface SignedUpstreamHeaders {
  "x-liner-signature": string;
  "x-liner-timestamp": string;
  "x-liner-nonce": string;
}

/** Sign an upstream call exactly like the browser client does. */
export function signUpstreamRequest(
  method: string,
  path: string,
  body?: string | null,
): SignedUpstreamHeaders {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = toBase64Url(crypto.randomBytes(8));
  const bodySha = crypto
    .createHash("sha256")
    .update(body ?? "", "utf8")
    .digest("hex");
  const canonical = `${method.toUpperCase().trim()}\n${path.split("?")[0].trim()}\n${timestamp}\n${nonce}\n${bodySha}`;
  const mac = crypto.createHmac("sha256", deriveKey()).update(canonical).digest();
  return {
    "x-liner-signature": toBase64Url(mac),
    "x-liner-timestamp": timestamp,
    "x-liner-nonce": nonce,
  };
}
