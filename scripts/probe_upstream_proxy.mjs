// Probe the ?upstream=1 lyrics relay: sign like the browser signer does,
// call OUR same-origin /v1 endpoint, and print what comes back.
// Expected with a dummy bearer: upstream 401 JSON "Sign in to Liner to see
// lyrics." — proving relay -> WAF pass -> upstream -> signature accepted.
import { createHash, createHmac } from "node:crypto";

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

function deriveKey() {
  let ks = Buffer.alloc(0);
  for (let i = 0; ks.length < 64; i = (i + 1) & 0xff) {
    ks = Buffer.concat([ks, createHash("sha256").update(Buffer.concat([Buffer.from(OBF_API_SEED), Buffer.from([i])])).digest()]);
  }
  const key = Buffer.alloc(64);
  for (let idx = 0; idx < 64; idx++) key[idx] = OBF_API_KEY[idx] ^ ks[idx];
  return key;
}

const key = deriveKey();
const path = "/v1/tracks/dQw4w9WgXcQ/lyrics";
const ts = Math.floor(Date.now() / 1000);
const nonce = Math.random().toString(36).slice(2, 13);
const bodySha = createHash("sha256").update("").digest("hex");
const canonical = `GET\n${path}\n${ts}\n${nonce}\n${bodySha}`;
const sig = createHmac("sha256", key).update(canonical).digest("base64url");

const base = process.env.PROBE_BASE || "http://localhost:3000";
const url = `${base}${path}?title=i%20have%20no%20friends&artist=s0rrow&upstream=1`;
const res = await fetch(url, {
  headers: {
    accept: "application/json, text/event-stream",
    authorization: "Bearer dummy-bearer-probe",
    "x-client-version": "1.0.4-desktop",
    "x-platform": "web",
    "x-liner-signature": sig,
    "x-liner-timestamp": String(ts),
    "x-liner-nonce": nonce,
  },
});
const text = await res.text();
console.log("status:", res.status);
console.log("content-type:", res.headers.get("content-type"));
console.log("body[:300]:", text.slice(0, 300).replace(/\n/g, " | "));
