// Probe the upstream (api.tryliner.fun) via the same-origin relay:
//  1. register a throwaway account (PoW solved with hash-wasm)
//  2. GET /v1/me — inspect the real JSON shape (pro fields?)
//  3. GET /v1/tracks/:id/lyrics — the signed-in word-level SSE
//  4. GET /v1/me/subscription etc. — find where Pro lives
const crypto = require("node:crypto");
const fs = require("fs");
const path = require("path");

const ROOT = "/home/z/my-project";
const wasmSrc = fs.readFileSync(path.join(ROOT, "liner-app/electron/signer.ts"), "utf8");
const m = wasmSrc.match(/SIGNER_WASM_BASE64\s*=\s*"([^"]+)"/);
const instance = new WebAssembly.Instance(new WebAssembly.Module(Buffer.from(m[1], "base64")), {});
const w = instance.exports;
function pass(str) {
  const b = Buffer.from(str, "utf8");
  const p = w.liner_alloc(b.length);
  new Uint8Array(w.memory.buffer, p, b.length).set(b);
  return { p, l: b.length };
}
function res() {
  const p = w.liner_get_result_ptr(), l = w.liner_get_result_len();
  return l ? Buffer.from(new Uint8Array(w.memory.buffer, p, l)).toString("utf8") : "";
}
function sign(method, path, body, ts, nonce) {
  const a = pass(method), b = pass(path), c = pass(body), d = pass(nonce);
  try {
    const code = w.liner_sign_request(a.p, a.l, b.p, b.l, c.p, c.l, BigInt(ts), d.p, d.l);
    if (code) throw new Error("code " + code);
    return res();
  } finally { [a, b, c, d].forEach((x) => w.liner_dealloc(x.p, x.l)); }
}

const BASE = process.env.PROBE_BASE || "http://localhost:3000";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) liner-desktop/0.2.12 Chrome/134.0.0.0 Electron/44.0.0 Safari/537.36";
let TOKEN = null;

async function call(name, method, pathWithQuery, body, auth = true) {
  const bodyText = body ? JSON.stringify(body) : "";
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(8).toString("hex");
  const sig = sign(method, pathWithQuery, bodyText, ts, nonce);
  const headers = {
    "user-agent": UA,
    "x-client-version": "1.0.4-desktop",
    "x-platform": "linux",
    "x-liner-signature": sig,
    "x-liner-timestamp": String(ts),
    "x-liner-nonce": nonce,
    "accept": "application/json",
    ...(auth && TOKEN ? { "authorization": `Bearer ${TOKEN}` } : {}),
  };
  if (bodyText) headers["content-type"] = "application/json";
  const r = await fetch(`${BASE}${pathWithQuery}`, { method, headers, body: bodyText || undefined });
  const text = await r.text();
  return { status: r.status, text, headers: r.headers };
}

// ---- argon2id PoW (same algorithm as the SPA) ----
async function solvePow(ch) {
  const { argon2id } = require(path.join(ROOT, "liner-app/node_modules/hash-wasm"));
  const b64 = ch.salt.replace(/-/g, "+").replace(/_/g, "/");
  const salt = Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64");
  const maxTries = 2 ** Math.min(ch.difficulty + 6, 30);
  for (let nonce = 0; nonce < maxTries; nonce += 1) {
    const hash = await argon2id({
      password: `${ch.token}:${nonce}`,
      salt,
      parallelism: ch.parallelism,
      iterations: ch.iterations,
      memorySize: ch.memoryKiB,
      hashLength: ch.hashLength,
      outputType: "binary",
    });
    let bits = 0;
    for (const byte of hash) {
      if (byte === 0) { bits += 8; continue; }
      bits += Math.clz32(byte) - 24;
      break;
    }
    if (bits >= ch.difficulty) return { token: ch.token, nonce: String(nonce) };
  }
  throw new Error("pow budget exhausted");
}

(async () => {
  const email = `probe${Date.now()}@probe.invalid`;
  const password = "ProbePass123!";

  // 1. challenge
  const ch = await call("challenge", "POST", "/v1/auth/challenge", { purpose: "register", email }, false);
  console.log("[challenge]", ch.status, ch.text.slice(0, 400));
  if (ch.status !== 200) process.exit(1);
  const challenge = JSON.parse(ch.text);
  if (challenge.turnstile && challenge.turnstile.mode !== "off") {
    console.log("[!] turnstile mode:", JSON.stringify(challenge.turnstile));
  }

  // 2. solve + register
  const pow = await solvePow(challenge);
  console.log("[pow] solved, nonce =", pow.nonce);
  const reg = await call("register", "POST", "/v1/auth/register", {
    email, password,
    username: `probe${Math.floor(Date.now() / 1000) % 1000000}`,
    displayName: "Probe Account",
    pow,
    ...(challenge.turnstile && challenge.turnstile.mode !== "off" ? {} : {}),
  }, false);
  console.log("[register]", reg.status, reg.text.slice(0, 500));
  if (reg.status !== 200) process.exit(1);
  const tokens = JSON.parse(reg.text);
  TOKEN = tokens.accessToken;
  console.log("[tokens] keys:", Object.keys(tokens).join(","));
  if (tokens.user) console.log("[register.user]", JSON.stringify(tokens.user).slice(0, 600));

  // 3. /v1/me — the shape that drives Pro
  const me = await call("me", "GET", "/v1/me");
  console.log("[me]", me.status, me.text.slice(0, 900));

  // 4. possible subscription/pro endpoints
  for (const p of ["/v1/me/subscription", "/v1/me/pro", "/v1/subscription", "/v1/me/billing"]) {
    const r = await call(p, "GET", p).catch(() => null);
    if (r) console.log(`[${p}]`, r.status, r.text.slice(0, 240));
  }

  // 5. upstream lyrics for a signed-in account (word-level providers)
  const lyr = await call("lyrics", "GET", "/v1/tracks/test123/lyrics?title=Shape%20of%20You&artist=Ed%20Sheeran&durationMs=233716");
  console.log("[lyrics]", lyr.status, "content-type:", lyr.headers.get("content-type"));
  console.log("[lyrics body]", lyr.text.slice(0, 1000));

  // 6. a catalog search so we have a REAL track id, then its lyrics
  const search = await call("search", "GET", "/v1/catalog/search?q=shape%20of%20you&type=track&limit=3");
  console.log("[search]", search.status, search.text.slice(0, 400));
  try {
    const data = JSON.parse(search.text);
    const items = data?.items || data?.tracks || [];
    const track = items[0];
    if (track?.id) {
      const lyr2 = await call("lyrics-real", "GET", `/v1/tracks/${encodeURIComponent(track.id)}/lyrics?title=${encodeURIComponent(track.title || "shape of you")}&artist=${encodeURIComponent(track.artists?.map(a => a.name || a).join(", ") || "ed sheeran")}`);
      console.log("[lyrics-real]", lyr2.status, "ct:", lyr2.headers.get("content-type"), lyr2.text.slice(0, 900));
    } else {
      console.log("[search] no track id in items:", JSON.stringify(data).slice(0, 400));
    }
  } catch (e) { console.log("[search parse]", e.message); }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
