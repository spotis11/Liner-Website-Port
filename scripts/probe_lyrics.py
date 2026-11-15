#!/usr/bin/env python3
"""Probe the real Liner lyrics provider ("Polaris Mono", api.tryliner.fun).

Logs in as the upstream test account through the relay (PoW + HMAC, same as
the browser), finds the track from the user's screenshot ("i have no friends"
by s0rrow), then probes candidate lyrics routes via the relay AND directly
against api.tryliner.fun (anonymous + signed) to find the real provider route.
"""
import base64
import hashlib
import hmac as hmac_mod
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.request
import urllib.parse

BASE = "http://localhost:3000"
UPSTREAM = "https://api.tryliner.fun"
EMAIL = os.environ["LINER_TEST_EMAIL"]
PASSWORD = os.environ["LINER_TEST_PASS"]

OBF_API_SEED = bytes.fromhex("55c35caa3f3c326daa630f90395d6636")
OBF_API_KEY = bytes.fromhex(
    "2499562b8020c1b7f67d7491e4c37f67"
    "1a0e8af37f50af2e05d5a7b0be6e3111"
    "40f342ad31f6cbeab5baddd08e56558c"
    "b4e51d82690c3fb23082a7f49bba9b70"
)
API_KEY_CHECKSUM = bytes.fromhex("e209025583eef007")


def derive_key():
    ks = b""
    i = 0
    while len(ks) < 64:
        ks += hashlib.sha256(OBF_API_SEED + bytes([i & 0xFF])).digest()
        i = (i + 1) & 0xFF
    key = bytes(a ^ b for a, b in zip(OBF_API_KEY, ks[:64]))
    assert hashlib.sha256(key).digest()[:8] == API_KEY_CHECKSUM
    return key


KEY = derive_key()
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "liner-desktop/0.2.12 Chrome/134.0.0.0 Electron/44.0.0 Safari/537.36")


def sign(method, path, body):
    ts = str(int(time.time()))
    nonce = base64.urlsafe_b64encode(secrets.token_bytes(8)).decode().rstrip("=")
    body_sha = hashlib.sha256((body or "").encode()).hexdigest()
    canonical = f"{method.upper()}\n{path.split('?')[0]}\n{ts}\n{nonce}\n{body_sha}"
    mac = hmac_mod.new(KEY, canonical.encode(), hashlib.sha256).digest()
    return {
        "x-liner-signature": base64.urlsafe_b64encode(mac).decode().rstrip("="),
        "x-liner-timestamp": ts,
        "x-liner-nonce": nonce,
    }


def call(method, path, payload=None, token=None, base=BASE):
    body = json.dumps(payload) if payload is not None else None
    headers = {"user-agent": UA, "accept": "application/json"}
    if body is not None:
        headers["content-type"] = "application/json"
    headers.update(sign(method, path, body))
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = urllib.request.Request(base + path, data=body.encode() if body else None,
                                 headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")


def login():
    st, body = call("POST", "/v1/auth/challenge", {"purpose": "login", "email": EMAIL})
    ch = json.loads(body)
    pow_body = {"email": EMAIL, "password": PASSWORD}
    if ch.get("algorithm") == "argon2id-v1" and ch.get("mode") != "off":
        from argon2.low_level import Type, hash_secret_raw
        salt = base64.urlsafe_b64decode(ch["salt"] + "=" * (-len(ch["salt"]) % 4))
        for nonce in range(2 ** min(ch["difficulty"] + 6, 30)):
            h = hash_secret_raw(secret=f"{ch['token']}:{nonce}".encode(), salt=salt,
                                time_cost=ch["iterations"], memory_cost=ch["memoryKiB"],
                                parallelism=ch["parallelism"], hash_len=ch["hashLength"],
                                type=Type.ID)
            bits = 0
            for byte in h:
                if byte == 0:
                    bits += 8
                    continue
                bits += 8 - byte.bit_length()
                break
            if bits >= ch["difficulty"]:
                pow_body["pow"] = {"token": ch["token"], "nonce": str(nonce)}
                break
    st, body = call("POST", "/v1/auth/login", pow_body)
    print("login:", st)
    d = json.loads(body)
    return d.get("accessToken"), (d.get("user") or d)


tok, user = None, None

# --- direct upstream login (same protocol as the browser's linerLoginUpstream)
st, body = call("POST", "/v1/auth/login", {"email": EMAIL, "password": PASSWORD}, base=UPSTREAM)
print("direct upstream login:", st)
if st == 200:
    d = json.loads(body)
    tok = d.get("accessToken")
    user = d.get("user") or {}
    print("logged in upstream as:", user.get("username"))
else:
    print("  body:", body[:200])

# 1. find the track id (upstream direct, authenticated)
q = urllib.parse.quote("i have no friends s0rrow")
st, body = call("GET", f"/v1/catalog/search?query={q}&limit=3", token=tok, base=UPSTREAM)
print("upstream catalog/search:", st)
tid = None
if st == 200:
    d = json.loads(body)
    for key in ("tracks", "items"):
        arr = d.get(key) or []
        for it in arr[:3]:
            t = it.get("track", it)
            print("  ", t.get("id"), "|", t.get("title"), "|",
                  (t.get("artistList") or t.get("artists")))
            if tid is None and t.get("id"):
                tid = t["id"]
        if arr:
            break
print("TRACK:", tid)
if tid:
    open("/tmp/tid.txt", "w").write(tid)

    # 2. the lyrics route: anonymous vs signed vs bearer (SSE)
    lyr = f"/v1/tracks/{tid}/lyrics?title=i%20have%20no%20friends&artist=s0rrow&durationMs=99000&upstream=1"
    st2, b2 = call("GET", lyr, base=UPSTREAM)
    print(f"anon  lyrics -> {st2} {b2[:220] if st2 == 200 else b2[:120]}")
    st3, b3 = call("GET", lyr, token=tok, base=UPSTREAM)
    print(f"auth  lyrics -> {st3} {b3[:220] if st3 == 200 else b3[:120]}")
