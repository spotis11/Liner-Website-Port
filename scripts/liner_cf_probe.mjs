// Test CF/CORS behavior for the three request shapes we need.
import crypto from "node:crypto";

const OBF_API_SEED = Buffer.from([0x55,0xc3,0x5c,0xaa,0x3f,0x3c,0x32,0x6d,0xaa,0x63,0x0f,0x90,0x39,0x5d,0x66,0x36]);
const OBF_API_KEY = Buffer.from([0x24,0x99,0x56,0x2b,0x80,0x20,0xc1,0xb7,0xf6,0x7d,0x74,0x91,0xe4,0xc3,0x7f,0x67,0x1a,0x0e,0x8a,0xf3,0x7f,0x50,0xaf,0x2e,0x05,0xd5,0xa7,0xb0,0xbe,0x6e,0x31,0x11,0x40,0xf3,0x42,0xad,0x31,0xf6,0xcb,0xea,0xb5,0xba,0xdd,0xd0,0x8e,0x56,0x55,0x8c,0xb4,0xe5,0x1d,0x82,0x69,0x0c,0x3f,0xb2,0x30,0x82,0xa7,0xf4,0x9b,0xba,0x9b,0x70]);
const CHECKSUM = Buffer.from([0xe2,0x09,0x02,0x55,0x83,0xee,0xf0,0x07]);
let ks = Buffer.alloc(0);
for (let i = 0; ks.length < 64; i = (i + 1) & 0xff)
  ks = Buffer.concat([ks, crypto.createHash("sha256").update(OBF_API_SEED).update(Buffer.from([i])).digest()]);
const KEY = Buffer.alloc(64);
for (let i = 0; i < 64; i++) KEY[i] = OBF_API_KEY[i] ^ ks[i];
if (!crypto.createHash("sha256").update(KEY).digest().subarray(0, 8).equals(CHECKSUM)) { console.log("key FAIL"); process.exit(1); }

const sigHeaders = (method, path, body = "") => {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(8).toString("hex");
  const bsha = crypto.createHash("sha256").update(body).digest("hex");
  const canonical = `${method}\n${path.split("?")[0]}\n${ts}\n${nonce}\n${bsha}`;
  return {
    "x-liner-signature": crypto.createHmac("sha256", KEY).update(canonical).digest("base64url"),
    "x-liner-timestamp": String(ts),
    "x-liner-nonce": nonce,
  };
};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) tryliner/1.0.4 Chrome/132.0.0.0 Electron/34.0.0 Safari/537.36";
const BASE = "https://api.tryliner.fun";

function label(res, text) {
  const isCF = text.includes("Cloudflare") || text.includes("Just a moment") || text.includes("Attention Required");
  return `status=${res.status} cf=${isCF ? "BLOCK" : "pass"} cors-allow-methods=${res.headers.get("access-control-allow-methods") || "-"} allow-headers=${res.headers.get("access-control-allow-headers") || "-"} allow-origin=${res.headers.get("access-control-allow-origin") || "-"}`;
}

// 1. CORS preflight (what a browser sends before a signed POST)
{
  const res = await fetch(`${BASE}/v1/auth/login`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://liner-music.space-z.ai",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,x-liner-signature,x-liner-timestamp,x-liner-nonce,x-client-version,x-platform",
      "User-Agent": UA,
    },
  });
  const t = await res.text();
  console.log("[preflight]", label(res, t), "|", t.slice(0, 80).replace(/\n/g, " "));
}

// 2. POST /v1/auth/login with dummy creds (signed)
{
  const body = JSON.stringify({ email: "probe@probe.invalid", password: "wrongpass", pow: null, turnstile: null });
  const res = await fetch(`${BASE}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "User-Agent": UA, "x-client-version": "1.0.4-desktop", "x-platform": "desktop", Origin: "https://www.tryliner.fun", ...sigHeaders("POST", "/v1/auth/login", body) },
    body,
  });
  const t = await res.text();
  console.log("[login]", label(res, t), "|", t.slice(0, 160).replace(/\n/g, " "));
}

// 3. GET lyrics signed + dummy Bearer
{
  const path = "/v1/tracks/1ESns2NaTUs/lyrics?title=i%20have%20no%20friends&artist=s0rrow&durationMs=99000";
  const res = await fetch(`${BASE}${path}`, {
    headers: { accept: "application/json, text/event-stream", "User-Agent": UA, "x-client-version": "1.0.4-desktop", "x-platform": "desktop", authorization: "Bearer dummy.token.probe", ...sigHeaders("GET", "/v1/tracks/1ESns2NaTUs/lyrics") },
  });
  const t = await res.text();
  console.log("[lyrics+dummybearer]", label(res, t), "|", t.slice(0, 160).replace(/\n/g, " "));
}
