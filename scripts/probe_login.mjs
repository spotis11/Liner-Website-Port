#!/usr/bin/env node
/* Login probe: signs POST /v1/auth/login exactly like the relay's signer and
 * sends it to both upstream hosts, printing status + error code only (no
 * tokens). Credentials come from argv/env — never stored in this file.
 * Usage: node probe_login.mjs <email> <password>
 */
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
const b64u = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function sign(method, path, body) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = b64u(crypto.randomBytes(8));
  const bodySha = crypto.createHash("sha256").update(body ?? "", "utf8").digest("hex");
  const canonical = `${method.toUpperCase()}\n${path.split("?")[0]}\n${timestamp}\n${nonce}\n${bodySha}`;
  const mac = crypto.createHmac("sha256", deriveKey()).update(canonical).digest();
  return {
    "x-liner-signature": b64u(mac),
    "x-liner-timestamp": timestamp,
    "x-liner-nonce": nonce,
    "content-type": "application/json",
    accept: "application/json",
  };
}

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("usage: node probe_login.mjs <email> <password>");
  process.exit(1);
}

const HOSTS = ["https://api.tryliner.fun", "https://staging.tryliner.fun"];
const body = JSON.stringify({ email, password });

for (const host of HOSTS) {
  try {
    const res = await fetch(`${host}/v1/auth/login`, {
      method: "POST",
      headers: sign("POST", "/v1/auth/login", body),
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let summary = text.slice(0, 220);
    try {
      const data = JSON.parse(text);
      if (data?.accessToken) summary = `OK bearer=${data.accessToken.slice(0, 10)}…(masked)`;
      else if (data?.code) summary = `code=${data.code}`;
      else summary = JSON.stringify(data).slice(0, 220);
    } catch { /* keep raw */ }
    console.log(`${host}  →  HTTP ${res.status}  ${summary}`);
  } catch (err) {
    console.log(`${host}  →  ERROR ${err.message}`);
  }
}
