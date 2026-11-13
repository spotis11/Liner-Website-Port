// End-to-end relay test: signs with the REAL desktop WASM signer (hex nonce,
// like the desktop) and probes the same-origin relay on localhost:3000.
const crypto = require("node:crypto");
const fs = require("fs");

const src = fs.readFileSync("/home/z/my-project/liner-app/electron/signer.ts", "utf8");
const m = src.match(/SIGNER_WASM_BASE64\s*=\s*"([^"]+)"/);
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

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) liner-desktop/0.2.12 Chrome/134.0.0.0 Electron/44.0.0 Safari/537.36";
const BASE = process.argv[2] || "http://localhost:3000";

async function probe(name, method, path, body) {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(8).toString("hex");
  const sig = sign(method, path, body ?? "", ts, nonce);
  const headers = {
    "user-agent": UA,
    "x-client-version": "1.0.4-desktop",
    "x-platform": "linux",
    "x-liner-signature": sig,
    "x-liner-timestamp": String(ts),
    "x-liner-nonce": nonce,
    "accept": "application/json",
  };
  if (body) headers["content-type"] = "application/json";
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body || undefined });
  const text = await r.text();
  console.log(`[${name}] HTTP ${r.status}: ${text.slice(0, 240)}`);
  return { status: r.status, text };
}

(async () => {
  const body = JSON.stringify({ purpose: "login", email: "probe@example.com" });
  await probe("challenge(relay)", "POST", "/v1/auth/challenge", body);
  await probe("me(relay)", "GET", "/v1/me");
  await probe("search(relay)", "GET", "/v1/catalog/search?q=test&type=all");
  await probe("playback(relay)", "POST", "/v1/tracks/abc123/playback");
})();
