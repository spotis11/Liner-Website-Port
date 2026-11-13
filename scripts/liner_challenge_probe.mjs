// Probe the Liner auth challenge (what register/login require today).
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

function deobfuscateKey() {
  const ks = Buffer.alloc(64);
  let acc = Buffer.alloc(0);
  for (let i = 0; acc.length < 64; i = (i + 1) & 0xff) {
    acc = Buffer.concat([acc, crypto.createHash("sha256").update(OBF_API_SEED).update(Buffer.from([i])).digest()]);
  }
  Buffer.from(acc.subarray(0, 64)).forEach((b, idx) => (ks[idx] = b));
  const key = Buffer.alloc(64);
  for (let idx = 0; idx < 64; idx++) key[idx] = OBF_API_KEY[idx] ^ ks[idx];
  const ok = crypto.createHash("sha256").update(key).digest().subarray(0, 8).equals(API_KEY_CHECKSUM);
  return { key, ok };
}

const { key, ok } = deobfuscateKey();
if (!ok) { console.log("key derive FAIL"); process.exit(1); }

function signedHeaders(method, path, body) {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(8).toString("hex");
  const bodySha256 = crypto.createHash("sha256").update(body).digest("hex");
  const canonical = `${method}\n${path}\n${ts}\n${nonce}\n${bodySha256}`;
  return {
    "x-liner-signature": crypto.createHmac("sha256", key).update(canonical).digest("base64url"),
    "x-liner-timestamp": String(ts),
    "x-liner-nonce": nonce,
  };
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) tryliner/1.0.4 Chrome/132.0.0.0 Electron/34.0.0 Safari/537.36";

async function post(path, body) {
  const res = await fetch(`https://api.tryliner.fun${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "User-Agent": UA,
      "x-client-version": "1.0.4-desktop",
      "x-platform": "desktop",
      ...signedHeaders("POST", path, body),
    },
    body,
  });
  const text = await res.text();
  console.log(`POST ${path} -> ${res.status} ${res.headers.get("content-type")}`);
  console.log(text.slice(0, 500));
  return { res, text };
}

await post("/v1/auth/challenge", JSON.stringify({ purpose: "register", email: "liner-web-port@proton.me" }));
await post("/v1/auth/challenge", JSON.stringify({ purpose: "login", email: "liner-web-port@proton.me" }));
