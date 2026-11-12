#!/usr/bin/env python3
"""E2E: animated GIF avatar survives the profile API round-trip.

1. PIL generates a real 3-frame animated GIF (distinct colors).
2. Authenticate against the dev server (guest or register).
3. PATCH /api/auth/profile with avatarUrl = data:image/gif;base64,...
4. GET /api/auth/me -> assert the avatar comes back byte-identical AND
   still animated (>= 2 GCE marker pairs), and under the 400k slice limit.
"""
import base64
import io
import json
import sys
import urllib.error
import urllib.request

BASE = "http://localhost:3000"

# 1. real animated GIF
from PIL import Image

frames = []
for color in [(255, 0, 0), (0, 255, 0), (0, 0, 255)]:
    img = Image.new("RGB", (96, 96), color)
    frames.append(img)
buf = io.BytesIO()
frames[0].save(
    buf, format="GIF", save_all=True, append_images=frames[1:], duration=120, loop=0
)
gif_bytes = buf.getvalue()
gce_count = sum(
    1 for i in range(len(gif_bytes) - 1) if gif_bytes[i] == 0x21 and gif_bytes[i + 1] == 0xF9
)
data_url = "data:image/gif;base64," + base64.b64encode(gif_bytes).decode()
print(f"gif: {len(gif_bytes)} bytes, GCE markers={gce_count}, data url {len(data_url)} chars")
assert gce_count >= 2, "fixture GIF is not animated?"
assert len(data_url) <= 400_000, "fixture too large for the server slice"


def call(method, path, body=None, token=None):
    req = urllib.request.Request(
        BASE + path, method=method, data=json.dumps(body).encode() if body else None
    )
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


# 2. authenticate — try guest, fall back to register
status, guest = call("POST", "/api/auth/guest")
if status != 200 or not guest.get("accessToken"):
    status, guest = call(
        "POST",
        "/api/auth/register",
        {
            "username": f"gif_e2e_{int(__import__('time').time())}",
            "password": "GifE2e!Password1",
            "displayName": "GIF E2E",
        },
    )
assert status == 200 and guest.get("accessToken"), f"auth failed: {status} {guest}"
token = guest["accessToken"]
kind = "guest" if guest.get("isGuest") or "username" not in guest else "registered"
print(f"auth: {status} ({kind}), user={guest.get('username') or guest.get('displayName')}")

# 3. PATCH the animated GIF avatar
status, patched = call("PATCH", "/api/auth/profile", {"avatarUrl": data_url}, token)
assert status == 200, f"PATCH failed: {status} {patched}"
print(f"PATCH /api/auth/profile: {status}")

# 4. round-trip via /me
status, me = call("GET", "/api/auth/me", token=token)
assert status == 200, f"/me failed: {status}"
avatar = me.get("avatarUrl")
assert avatar and avatar.startswith("data:image/gif;base64,"), f"avatar lost or wrong MIME: {avatar[:60] if avatar else None}"
decoded = base64.b64decode(avatar.split(",", 1)[1])
assert decoded == gif_bytes, "avatar bytes corrupted in round-trip"
rt_gce = sum(
    1 for i in range(len(decoded) - 1) if decoded[i] == 0x21 and decoded[i + 1] == 0xF9
)
assert rt_gce >= 2, f"avatar no longer animated (GCE={rt_gce})"
print(f"GET /api/auth/me: {status} -> avatar {len(avatar)} chars, {len(decoded)} bytes, GCE={rt_gce} — STILL ANIMATED")

# cleanup: remove the avatar so the account is pristine
status, _ = call("PATCH", "/api/auth/profile", {"avatarUrl": None}, token)
print(f"cleanup avatar: {status}")
print("E2E PASS: animated GIF avatar round-trips byte-identical through the API")
