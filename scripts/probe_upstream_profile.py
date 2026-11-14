#!/usr/bin/env python3
"""
Upstream profile-PATCH probe — logs in as a REAL upstream Liner account via
the same-origin relay (PoW + HMAC signature, identical to the browser client)
and then probes every plausible profile-update shape to see which one the
upstream accepts (the client currently PATCHes /v1/users/me and gets 404).

Creds come from env LINER_TEST_EMAIL / LINER_TEST_PASS — never stored here.
Run: LINER_TEST_EMAIL=... LINER_TEST_PASS=... python3 scripts/probe_upstream_profile.py [base]
"""
import base64
import hashlib
import hmac as hmac_mod
import json
import os
import secrets
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
EMAIL = os.environ["LINER_TEST_EMAIL"]
PASSWORD = os.environ["LINER_TEST_PASS"]

# ---- signer key derivation (replicates liner-app requestSigner.ts) ----
OBF_API_SEED = bytes.fromhex(
    "55c35caa3f3c326daa630f90395d6636"
)
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
    digest = hashlib.sha256(key).digest()
    assert digest[:8] == API_KEY_CHECKSUM, "key derivation checksum failed"
    return key


KEY = derive_key()
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "liner-desktop/0.2.12 Chrome/134.0.0.0 Electron/44.0.0 Safari/537.36")


def sign(method, path, body):
    ts = str(int(__import__("time").time()))
    nonce = base64.urlsafe_b64encode(secrets.token_bytes(8)).decode().rstrip("=")
    body_sha = hashlib.sha256((body or "").encode()).hexdigest()
    canonical = f"{method.upper()}\n{path.split('?')[0]}\n{ts}\n{nonce}\n{body_sha}"
    mac = hmac_mod.new(KEY, canonical.encode(), hashlib.sha256).digest()
    sig = base64.urlsafe_b64encode(mac).decode().rstrip("=")
    return {
        "x-liner-signature": sig,
        "x-liner-timestamp": ts,
        "x-liner-nonce": nonce,
    }


def call(method, path, payload=None, token=None):
    body = json.dumps(payload) if payload is not None else None
    headers = {"user-agent": UA, "accept": "application/json"}
    if body is not None:
        headers["content-type"] = "application/json"
    headers.update(sign(method, path, body))
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=body.encode() if body else None,
                                 headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")


def leading_zero_bits(b):
    bits = 0
    for byte in b:
        if byte == 0:
            bits += 8
            continue
        return bits + 8 - byte.bit_length()
    return bits


def b64url_decode(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


print("== challenge ==")
st, body = call("POST", "/v1/auth/challenge", {"purpose": "login", "email": EMAIL})
print("challenge:", st, body[:160])
ch = json.loads(body)

if ch.get("algorithm") == "argon2id-v1" and ch.get("mode") != "off":
    from argon2.low_level import Type, hash_secret_raw
    salt = b64url_decode(ch["salt"])
    nonce = 0
    max_tries = 2 ** min(ch["difficulty"] + 6, 30)
    print(f"solving PoW: difficulty={ch['difficulty']} mem={ch['memoryKiB']}KiB iter={ch['iterations']}")
    import time
    t0 = time.time()
    for nonce in range(max_tries):
        h = hash_secret_raw(secret=f"{ch['token']}:{nonce}".encode(), salt=salt,
                            time_cost=ch["iterations"], memory_cost=ch["memoryKiB"],
                            parallelism=ch["parallelism"], hash_len=ch["hashLength"],
                            type=Type.ID)
        if leading_zero_bits(h) >= ch["difficulty"]:
            break
    else:
        nonce = None
    print(f"PoW solved: nonce={nonce} in {time.time()-t0:.1f}s" if nonce is not None
          else "PoW FAILED to solve in budget")
else:
    nonce = None

pow_body = {"email": EMAIL, "password": PASSWORD}
if nonce is not None:
    pow_body["pow"] = {"token": ch["token"], "nonce": str(nonce)}

print("== login ==")
st, body = call("POST", "/v1/auth/login", pow_body)
print("login:", st, body[:220])
if st != 200:
    sys.exit(1)
tok = json.loads(body).get("accessToken") or json.loads(body).get("access_token")
print("token prefix:", tok[:6] + "...")

print("\n== profile PATCH probes (the browser sends: PATCH /v1/users/me {bio}) ==")
probes = [
    ("PATCH", "/v1/users/me", {"bio": "probe bio A"}),
    ("PATCH", "/v1/users/me", {"bio": "probe bio B", "displayName": "JayJoice"}),
    ("PATCH", "/v1/me", {"bio": "probe bio C"}),
    ("PUT", "/v1/users/me", {"bio": "probe bio D"}),
    ("PATCH", "/v1/user", {"bio": "probe bio E"}),
    ("PATCH", "/v1/profile", {"bio": "probe bio F"}),
    ("POST", "/v1/users/me", {"bio": "probe bio G"}),
    ("GET", "/v1/users/me", None),
]
for m, p, pl in probes:
    st, body = call(m, p, pl, token=tok)
    print(f"{m:6} {p:18} {json.dumps(pl) if pl else '(GET)':46} -> {st}  {body[:150]}")

print("\n== full GET /v1/me body (user shape) ==")
st, body = call("GET", "/v1/me", None, token=tok)
print("status:", st)
print(json.dumps(json.loads(body), indent=1)[:1200])
