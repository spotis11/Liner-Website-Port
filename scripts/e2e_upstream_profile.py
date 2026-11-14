#!/usr/bin/env python3
"""
E2E: profile editing for UPSTREAM Liner sessions (the bio-save fix).

Logs in as a REAL upstream account (PoW + HMAC signing, same as the browser),
then walks the whole Account-tab surface against the same-origin relay:
  1. PATCH /v1/users/me {bio}            -> 200, stored in UpstreamProfile
  2. GET  /v1/me                         -> merged user carries the bio
  3. PATCH displayName / username rules  -> 200 / 400 INVALID_USERNAME / 409 TAKEN
  4. privacy flags                       -> stored + merged
  5. avatar: small data URL inline, 6.3MB GIF rewritten to /api/avatar/<id>
     and served byte-identical (Pro cap via the jayzeyluna owner overlay)
  6. isPro true on both login user and /v1/me (owner username overlay)
Creds from env LINER_TEST_EMAIL / LINER_TEST_PASS. Run against dev :3000.
"""
import base64
import hashlib
import hmac as hmac_mod
import io
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
EMAIL = os.environ["LINER_TEST_EMAIL"]
PASSWORD = os.environ["LINER_TEST_PASS"]
FAILURES = []


def check(name, ok, detail=""):
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        FAILURES.append(name)


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
    check("upstream login through relay", st == 200, f"{st} {body[:120]}")
    d = json.loads(body)
    return d.get("accessToken"), (d.get("user") or d)


def make_big_gif_data_url(target_bytes=6 * 1024 * 1024):
    from PIL import Image
    import random
    random.seed(11)
    frames = []
    n = 0
    while True:
        im = Image.effect_noise((256, 256), 50).convert("L").convert(
            "P", palette=Image.ADAPTIVE, colors=16)
        frames.append(im)
        n += 1
        buf = io.BytesIO()
        frames[0].save(buf, format="GIF", save_all=True,
                       append_images=frames[1:], duration=80, loop=0)
        if buf.tell() >= target_bytes or n >= 400:
            break
    data = buf.getvalue()
    return "data:image/gif;base64," + base64.b64encode(data).decode(), len(data)


# ---- 1+2: bio save + merge ----
tok, login_user = login()
print(f"[setup] logged in as {login_user.get('username')} ({login_user.get('displayName')})")
check("login user carries isPro (owner overlay)", login_user.get("isPro") is True,
      f"isPro={login_user.get('isPro')}")

st, body = call("PATCH", "/v1/users/me", {"bio": "e2e upstream bio line"}, token=tok)
check("PATCH /v1/users/me bio -> 200 (the actual bug)", st == 200, f"{st} {body[:160]}")
merged = json.loads(body) if st == 200 else {}
check("PATCH response carries the new bio", merged.get("bio") == "e2e upstream bio line",
      str(merged.get("bio"))[:80])

st, body = call("GET", "/v1/me", None, token=tok)
me = json.loads(body).get("user", json.loads(body)) if st == 200 else {}
check("GET /v1/me merges stored bio", me.get("bio") == "e2e upstream bio line",
      f"{st} bio={str(me.get('bio'))[:60]}")

# ---- 3: display name + username rules ----
st, body = call("PATCH", "/v1/users/me", {"displayName": "JayJoice E2E"}, token=tok)
check("displayName save -> 200", st == 200 and json.loads(body).get("displayName") == "JayJoice E2E", f"{st} {body[:120]}")
st, body = call("GET", "/v1/me", None, token=tok)
me = json.loads(body).get("user", json.loads(body))
check("merged GET carries displayName", me.get("displayName") == "JayJoice E2E", str(me.get("displayName")))

st, body = call("PATCH", "/v1/users/me", {"username": "ab"}, token=tok)
try:
    err = json.loads(body) if body else {}
except Exception:
    err = {"raw": body[:80]}
check("2-char username -> 400 INVALID_USERNAME", st == 400 and err.get("code") == "INVALID_USERNAME", f"{st} {err}")

st, body = call("PATCH", "/v1/users/me", {"username": "jayzeyluna"}, token=tok)
check("own current username accepted (no-op)", st == 200, f"{st} {body[:120]}")

st, body = call("PATCH", "/v1/users/me", {"username": "guest_test_name_xyz"}, token=tok)
check("new username save -> 200", st == 200 and json.loads(body).get("username") == "guest_test_name_xyz", f"{st} {body[:120]}")
st, body = call("GET", "/v1/me", None, token=tok)
me = json.loads(body).get("user", json.loads(body))
check("merged GET shows overridden username", me.get("username") == "guest_test_name_xyz", str(me.get("username")))
check("Pro flag survives username override (real account stays Pro)", me.get("isPro") is True, f"isPro={me.get('isPro')}")
call("PATCH", "/v1/users/me", {"username": "jayzeyluna"}, token=tok)

# ---- 4: privacy flags ----
st, body = call("PATCH", "/v1/users/me", {"showActivity": False, "isPublic": False}, token=tok)
check("privacy toggles -> 200", st == 200, f"{st} {body[:120]}")
st, body = call("GET", "/v1/me", None, token=tok)
me = json.loads(body).get("user", json.loads(body))
check("privacy flags merged back", me.get("showActivity") is False and me.get("isPublic") is False,
      f"showActivity={me.get('showActivity')} isPublic={me.get('isPublic')}")
call("PATCH", "/v1/users/me", {"showActivity": True, "isPublic": True}, token=tok)

# ---- 5: avatar small + big GIF (Pro cap via owner username) ----
st, body = call("PATCH", "/v1/users/me", {"avatarUrl": "data:image/png;base64,iVBORw0KGgo="}, token=tok)
check("small avatar inline -> 200", st == 200 and json.loads(body).get("avatarUrl") == "data:image/png;base64,iVBORw0KGgo=", f"{st} {body[:100]}")

gif_url, gif_len = make_big_gif_data_url()
print(f"[setup] big animated GIF: {gif_len/1e6:.1f} MB raw ({len(gif_url)/1e6:.1f}M chars)")
st, body = call("PATCH", "/v1/users/me", {"avatarUrl": gif_url}, token=tok)
avatar = json.loads(body).get("avatarUrl", "") if st == 200 else ""
check("Pro accepts 6.3MB animated GIF", st == 200, f"{st} {body[:140]}")
check("big avatar rewritten to /api/avatar/<id>", avatar.startswith("/api/avatar/"), avatar[:60])

st2, raw = call("GET", avatar)
check("GET /api/avatar/<id> (no auth) -> 200", st2 == 200, str(st2))
# large-body reads through urllib can be flaky against next dev — verify the
# bytes via curl (deterministic full download) and cross-check sizes
import subprocess
out = subprocess.run(
    ["curl", "-s", "-o", "/tmp/av_e2e.bin", "-w", "%{http_code}", "--max-time", "90",
     BASE + avatar],
    capture_output=True, text=True, timeout=120,
).stdout.strip()
orig = base64.b64decode(gif_url.split(",", 1)[1])
import pathlib
served = pathlib.Path("/tmp/av_e2e.bin").read_bytes()
check("GET /api/avatar/<id> -> 200 (curl)", out == "200", str(out))
check("avatar bytes identical (curl, full download)", served == orig,
      f"len={len(served)} vs {len(orig)}")

st, body = call("PATCH", "/v1/users/me", {"avatarUrl": None}, token=tok)
check("avatar clear (null) -> 200, cleared", st == 200 and json.loads(body).get("avatarUrl") in (None, ""), f"{st} {body[:100]}")

# ---- 6: guest negative check still intact (website route) ----
st, body = call("POST", "/api/auth/guest", payload={})
gtok = json.loads(body)["accessToken"]
# 8.4MB PATCH body — send via curl from a temp file (arg list too long otherwise)
pathlib.Path("/tmp/guest413_body.json").write_text(json.dumps({"avatarUrl": gif_url}))
code = subprocess.run(
    ["curl", "-s", "-o", "/tmp/guest413.json", "-w", "%{http_code}",
     "-X", "PATCH", BASE + "/api/auth/profile",
     "-H", "authorization: Bearer " + gtok,
     "-H", "content-type: application/json",
     "--data-binary", "@/tmp/guest413_body.json",
     "--max-time", "120"],
    capture_output=True, text=True, timeout=180,
).stdout.strip()
body413 = open("/tmp/guest413.json").read()
try:
    err = json.loads(body413)
except Exception:
    err = {"raw": body413[:80]}
check("guest still 413 AVATAR_TOO_LARGE on website route",
      code == "413" or (err.get("code") == "AVATAR_TOO_LARGE"),
      f"http={code} code={err.get('code')} raw={body413[:60]}")

print()
print("ALL UPSTREAM PROFILE CHECKS PASSED" if not FAILURES else f"FAILED: {FAILURES}")
sys.exit(1 if FAILURES else 0)
