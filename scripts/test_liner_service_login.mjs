// One-off check: does the LINER_SERVICE_* pair in the gitignored .env
// actually authenticate against the upstream Liner login?
// Mirrors src/lib/linerUpstreamService.ts + upstreamSigner.ts exactly.
// Never prints credentials — only HTTP status / token presence.
import crypto from "node:crypto";
import fs from "node:fs";

const env = {};
for (const line of fs.readFileSync("/home/z/my-project/.env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const email = env.LINER_SERVICE_EMAIL;
const pass = env.LINER_SERVICE_PASS;
if (!email || !pass) {
  console.error("LINER_SERVICE_EMAIL/PASS not set in .env");
  process.exit(1);
}

// --- signer constants (duplicated from src/lib/upstreamSigner.ts) ---
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
const API_KEY_CHECKSUM = Uint8Array.from([0xe2, 0x09, 0x02, 0x55, 0x83, 0xee, 0xf0, 0x07]);

function deriveKey() {
  const seed = Buffer.from(OBF_API_SEED);
  let ks = Buffer.alloc(0);
  for (let i = 0; ks.length < 64; i = (i + 1) & 0xff) {
    ks = Buffer.concat([ks, crypto.createHash("sha256").update(Buffer.concat([seed, Buffer.of(i)])).digest()]);
  }
  const key = Buffer.alloc(64);
  for (let idx = 0; idx < 64; idx++) key[idx] = OBF_API_KEY[idx] ^ ks[idx];
  const digest = crypto.createHash("sha256").update(key).digest();
  if (!digest.subarray(0, 8).equals(Buffer.from(API_KEY_CHECKSUM))) {
    throw new Error("signer key derivation failed");
  }
  return key;
}
function toBase64Url(bytes) {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function signUpstreamRequest(method, path, body) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = toBase64Url(crypto.randomBytes(8));
  const bodySha = crypto.createHash("sha256").update(body ?? "", "utf8").digest("hex");
  const canonical = `${method.toUpperCase().trim()}\n${path.split("?")[0].trim()}\n${timestamp}\n${nonce}\n${bodySha}`;
  const mac = crypto.createHmac("sha256", deriveKey()).update(canonical).digest();
  return {
    "x-liner-signature": toBase64Url(mac),
    "x-liner-timestamp": timestamp,
    "x-liner-nonce": nonce,
  };
}

const UPSTREAM = "https://api.tryliner.fun";
const body = JSON.stringify({ email, password: pass });
const signed = signUpstreamRequest("POST", "/v1/auth/login", body);
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 30_000);
try {
  const res = await fetch(`${UPSTREAM}/v1/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) liner-desktop/0.2.12 Chrome/134.0.0.0 Electron/44.0.0 Safari/537.36",
      "x-client-version": "1.0.4-desktop",
      "x-platform": "web",
      ...signed,
    },
    body,
    signal: controller.signal,
    redirect: "manual",
  });
  const ct = res.headers.get("content-type") ?? "";
  let token = null, expiresAt = null, errSnippet = "";
  if (ct.includes("application/json")) {
    const data = await res.json();
    token = data.accessToken ?? null;
    expiresAt = data.accessTokenExpiresAt ?? null;
    if (!token) errSnippet = JSON.stringify(data).slice(0, 200);
  } else {
    errSnippet = (await res.text()).slice(0, 200);
  }
  console.log(`upstream login: HTTP ${res.status} | token: ${token ? "PRESENT (" + token.length + " chars)" : "absent"} | expiresAt: ${expiresAt ?? "n/a"}`);
  if (errSnippet) console.log(`body snippet: ${errSnippet}`);
  process.exit(res.ok && token ? 0 : 2);
} catch (e) {
  console.error("upstream login failed:", e.message);
  process.exit(1);
} finally {
  clearTimeout(timer);
}
