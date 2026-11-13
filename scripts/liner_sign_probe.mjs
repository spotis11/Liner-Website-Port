// Probe: de-obfuscate the Liner API signing key (from the official
// tryliner/desktop signer/src/crypto.rs constants), verify the embedded
// checksum, then test a SIGNED lyrics request against api.tryliner.fun.
// The key itself is NEVER printed.
import crypto from "node:crypto";

const OBF_API_SEED = Buffer.from([
  0x55, 0xc3, 0x5c, 0xaa, 0x3f, 0x3c, 0x32, 0x6d, 0xaa, 0x63, 0x0f, 0x90,
  0x39, 0x5d, 0x66, 0x36,
]);
const OBF_API_KEY = Buffer.from([
  0x24, 0x99, 0x56, 0x2b, 0x80, 0x20, 0xc1, 0xb7, 0xf6, 0x7d, 0x74, 0x91,
  0xe4, 0xc3, 0x7f, 0x67, 0x1a, 0x0e, 0x8a, 0xf3, 0x7f, 0x50, 0xaf, 0x2e,
  0x05, 0xd5, 0xa7, 0xb0, 0xbe, 0x6e, 0x31, 0x11, 0x40, 0xf3, 0x42, 0xad,
  0x31, 0xf6, 0xcb, 0xea, 0xb5, 0xba, 0xdd, 0xd0, 0x8e, 0x56, 0x55, 0x8c,
  0xb4, 0xe5, 0x1d, 0x82, 0x69, 0x0c, 0x3f, 0xb2, 0x30, 0x82, 0xa7, 0xf4,
  0x9b, 0xba, 0x9b, 0x70,
]);
const API_KEY_CHECKSUM = Buffer.from([0xe2, 0x09, 0x02, 0x55, 0x83, 0xee, 0xf0, 0x07]);

function keystream(seed, length) {
  const out = Buffer.alloc(0);
  let acc = Buffer.alloc(0);
  let i = 0;
  while (acc.length < length) {
    const h = crypto.createHash("sha256");
    h.update(seed);
    h.update(Buffer.from([i]));
    acc = Buffer.concat([acc, h.digest()]);
    i = (i + 1) & 0xff;
  }
  return acc.subarray(0, length);
}

function deobfuscateKey() {
  const ks = keystream(OBF_API_SEED, 64);
  const key = Buffer.alloc(64);
  for (let idx = 0; idx < 64; idx++) key[idx] = OBF_API_KEY[idx] ^ ks[idx];
  const digest = crypto.createHash("sha256").update(key).digest();
  const ok = digest.subarray(0, 8).equals(API_KEY_CHECKSUM);
  return { key, ok };
}

function signWithKey(key, method, path, body, timestamp, nonce) {
  const bodySha256 = crypto.createHash("sha256").update(body).digest("hex");
  const canonical = `${method.toUpperCase().trim()}\n${path.split("?")[0].trim()}\n${timestamp}\n${nonce}\n${bodySha256}`;
  return crypto.createHmac("sha256", key).update(canonical).digest("base64url");
}

const { key, ok } = deobfuscateKey();
console.log("checksum verify:", ok ? "OK (key reconstructed)" : "FAIL");
if (!ok) process.exit(1);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) tryliner/1.0.4 Chrome/132.0.0.0 Electron/34.0.0 Safari/537.36";

async function probe(label, headers, urlOverride) {
  const path = "/v1/tracks/1ESns2NaTUs/lyrics";
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(8).toString("hex");
  const sig = signWithKey(key, "GET", path, "", ts, nonce);
  const url =
    urlOverride ??
    `https://api.tryliner.fun${path}?title=${encodeURIComponent("i have no friends")}&artist=${encodeURIComponent("s0rrow")}&durationMs=99000`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json, text/event-stream",
        "User-Agent": UA,
        "x-request-id": `probe-${Date.now()}`,
        "x-client-version": "1.0.4-desktop",
        "x-platform": "desktop",
        "x-liner-signature": sig,
        "x-liner-timestamp": String(ts),
        "x-liner-nonce": nonce,
        ...headers,
      },
    });
    const ct = res.headers.get("content-type") || "";
    const text = await res.text();
    console.log(`[${label}] status=${res.status} ct=${ct} bytes=${text.length}`);
    console.log(`[${label}] body-head: ${text.slice(0, 300).replace(/\n/g, " | ")}`);
  } catch (e) {
    console.log(`[${label}] FETCH ERROR: ${e.message}`);
  }
}

await probe("signed+electronUA", {});
await probe("signed+nodeUA", { "User-Agent": "node" });
