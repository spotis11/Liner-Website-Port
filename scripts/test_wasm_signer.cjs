// Runs the REAL desktop signer WASM and compares with the JS replica.
const crypto = require("node:crypto");
const fs = require("node:fs");

const src = fs.readFileSync("/home/z/my-project/liner-app/electron/signer.ts", "utf8");
const m = src.match(/SIGNER_WASM_BASE64\s*=\s*"([^"]+)"/);
if (!m) { console.error("no base64 found"); process.exit(1); }
const wasmBuffer = Buffer.from(m[1], "base64");

const instance = new WebAssembly.Instance(new WebAssembly.Module(wasmBuffer), {});
const w = instance.exports;

function pass(str) {
  const bytes = Buffer.from(str, "utf8");
  const ptr = w.liner_alloc(bytes.length);
  new Uint8Array(w.memory.buffer, ptr, bytes.length).set(bytes);
  return { ptr, len: bytes.length };
}
function result() {
  const ptr = w.liner_get_result_ptr();
  const len = w.liner_get_result_len();
  if (!ptr || len === 0) return "";
  return Buffer.from(new Uint8Array(w.memory.buffer, ptr, len)).toString("utf8");
}
function wasmSign(method, path, body, timestamp, nonce) {
  const a = pass(method), b = pass(path), c = pass(body), d = pass(nonce);
  try {
    const code = w.liner_sign_request(a.ptr, a.len, b.ptr, b.len, c.ptr, c.len, BigInt(timestamp), d.ptr, d.len);
    if (code !== 0) throw new Error("code " + code);
    return result();
  } finally { [a, b, c, d].forEach(x => w.liner_dealloc(x.ptr, x.len)); }
}

// ---- JS replica (requestSigner.ts fallback) ----
const OBF_API_SEED = Buffer.from([0x55,0xc3,0x5c,0xaa,0x3f,0x3c,0x32,0x6d,0xaa,0x63,0x0f,0x90,0x39,0x5d,0x66,0x36]);
const OBF_API_KEY = Buffer.from([0x24,0x99,0x56,0x2b,0x80,0x20,0xc1,0xb7,0xf6,0x7d,0x74,0x91,0xe4,0xc3,0x7f,0x67,0x1a,0x0e,0x8a,0xf3,0x7f,0x50,0xaf,0x2e,0x05,0xd5,0xa7,0xb0,0xbe,0x6e,0x31,0x11,0x40,0xf3,0x42,0xad,0x31,0xf6,0xcb,0xea,0xb5,0xba,0xdd,0xd0,0x8e,0x56,0x55,0x8c,0xb4,0xe5,0x1d,0x82,0x69,0x0c,0x3f,0xb2,0x30,0x82,0xa7,0xf4,0x9b,0xba,0x9b,0x70]);
function deriveKey() {
  let ks = Buffer.alloc(0);
  for (let i = 0; ks.length < 64; i = (i + 1) & 0xff) {
    ks = Buffer.concat([ks, crypto.createHash("sha256").update(Buffer.concat([OBF_API_SEED, Buffer.from([i])])).digest()]);
  }
  const key = Buffer.alloc(64);
  for (let i = 0; i < 64; i++) key[i] = OBF_API_KEY[i] ^ ks[i];
  const digest = crypto.createHash("sha256").update(key).digest();
  for (let i = 0; i < 8; i++) if (digest[i] !== Buffer.from([0xe2,0x09,0x02,0x55,0x83,0xee,0xf0,0x07])[i]) throw new Error("checksum fail");
  return key;
}
function replicaSign(method, path, body, ts, nonce) {
  const key = deriveKey();
  const bodySha = crypto.createHash("sha256").update(body ?? "").digest("hex");
  const canonical = `${method.toUpperCase().trim()}\n${path.split("?")[0].trim()}\n${ts}\n${nonce}\n${bodySha}`;
  return crypto.createHmac("sha256", key).update(canonical).digest("base64url");
}

const method = "POST", path = "/v1/auth/challenge", body = '{"purpose":"login"}', ts = 1731500000, nonce = "0123456789abcdef";
const wasmSig = wasmSign(method, path, body, ts, nonce);
const replicaSig = replicaSign(method, path, body, ts, nonce);
console.log("wasm   :", wasmSig);
console.log("replica:", replicaSig);
console.log(wasmSig === replicaSig ? "MATCH" : "DIFFER");

// also dump what the wasm signs for a raw payload to cross-check canonical
console.log("raw payload sign of 'a':", (() => {
  const p = pass("a");
  try { const code = w.liner_sign_raw_payload(p.ptr, p.len); return code === 0 ? result() : "code " + code; }
  finally { w.liner_dealloc(p.ptr, p.len); }
})());
