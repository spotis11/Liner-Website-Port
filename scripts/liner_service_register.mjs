// One-time: register the site's Liner service account via the official
// protocol (challenge mode "off" — no Turnstile/PoW today) and store the
// credentials in the gitignored .env. Token values are NEVER printed.
import crypto from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const ENV_PATH = "/home/z/my-project/.env";

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
  let ks = Buffer.alloc(0);
  for (let i = 0; ks.length < 64; i = (i + 1) & 0xff) {
    ks = Buffer.concat([ks, crypto.createHash("sha256").update(OBF_API_SEED).update(Buffer.from([i])).digest()]);
  }
  const key = Buffer.alloc(64);
  for (let idx = 0; idx < 64; idx++) key[idx] = OBF_API_KEY[idx] ^ ks[idx];
  const ok = crypto.createHash("sha256").update(key).digest().subarray(0, 8).equals(API_KEY_CHECKSUM);
  if (!ok) throw new Error("key derive failed");
  return key;
}
const KEY = deobfuscateKey();

function signedHeaders(method, path, body = "") {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(8).toString("hex");
  const bodySha256 = crypto.createHash("sha256").update(body).digest("hex");
  const canonical = `${method}\n${path.split("?")[0]}\n${ts}\n${nonce}\n${bodySha256}`;
  return {
    "x-liner-signature": crypto.createHmac("sha256", KEY).update(canonical).digest("base64url"),
    "x-liner-timestamp": String(ts),
    "x-liner-nonce": nonce,
  };
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) tryliner/1.0.4 Chrome/132.0.0.0 Electron/34.0.0 Safari/537.36";

async function call(method, path, bodyObj) {
  const body = bodyObj === undefined ? undefined : JSON.stringify(bodyObj);
  const res = await fetch(`https://api.tryliner.fun${path}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "User-Agent": UA,
      "x-client-version": "1.0.4-desktop",
      "x-platform": "desktop",
      Origin: "https://www.tryliner.fun",
      Referer: "https://www.tryliner.fun/",
      "sec-fetch-site": "same-site",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
      "accept-language": "en-US,en;q=0.9",
      ...signedHeaders(method, path, body ?? ""),
      ...(body ? {} : {}),
    },
    ...(body ? { body } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

// 1. pick an available username
const BASE = "linerwebport";
let username = BASE;
for (let i = 0; i < 4; i++) {
  const check = await call("GET", `/v1/auth/username-available?username=${username}`);
  const available = check.json?.available ?? check.json?.data?.available;
  console.log(`username "${username}" available:`, available, `(status ${check.status})`);
  if (available === true || check.status === 200) break;
  username = `${BASE}${Math.floor(Math.random() * 9000 + 1000)}`;
}

// 2. register
const email = `${username}@gmail.com`;
const password = crypto.randomBytes(24).toString("base64url");
const reg = await call("POST", "/v1/auth/register", {
  email,
  password,
  username,
  displayName: "Liner Web Port",
});
console.log("register status:", reg.status);
if (reg.status !== 200 || !reg.json) {
  console.log("register body head:", String(reg.text).slice(0, 300));
  process.exit(1);
}
console.log("AuthTokens keys:", Object.keys(reg.json).join(", "));
const accessToken = reg.json?.accessToken ?? reg.json?.data?.accessToken;
const refreshToken = reg.json?.refreshToken ?? reg.json?.data?.refreshToken;
if (!accessToken || !refreshToken) {
  console.log("no tokens in response — aborting (nothing written)");
  process.exit(1);
}

// 3. persist to .env (replace-or-append, values never printed)
const lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8").split("\n") : [];
const values = {
  LINER_SERVICE_EMAIL: email,
  LINER_SERVICE_USERNAME: username,
  LINER_SERVICE_PASSWORD: password,
  LINER_SERVICE_ACCESS_TOKEN: accessToken,
  LINER_SERVICE_REFRESH_TOKEN: refreshToken,
};
const map = new Map(lines.map((l) => [l.split("=", 1)[0], l]));
for (const [k, v] of Object.entries(values)) map.set(k, `${k}=${v}`);
writeFileSync(ENV_PATH, [...map.values()].filter((l) => l !== "").join("\n") + "\n", { mode: 0o600 });
console.log("saved to .env:", Object.keys(values).join(", "));
console.log("service account ready:", `${username} <${email}>`);
