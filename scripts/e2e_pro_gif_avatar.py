#!/usr/bin/env python3
"""E2E: Liner Pro animated GIF avatars up to 30 MB.

Verifies:
1. Real animated GIF (PIL, 3 frames) padded with a ~300 KB comment extension
   -> data URL > 400k chars (over the inline threshold).
2. Non-Pro: PATCH avatarUrl with it -> 413 AVATAR_TOO_LARGE (no corrupt slice).
3. Pro (isPro flipped in db): PATCH -> 200.
4. GET /me returns avatarUrl = /api/avatar/{id} and a SMALL payload.
5. GET /api/avatar/{id} -> 200 image/gif, byte-identical to the original.
6. Max-size probe: ~30 MB GIF (body ~42 MB) -> 200.
7. Over-limit probe: ~35 MB GIF (body ~47 MB) -> 413 (proves Next accepts
   multi-MB bodies and the server cap rejects past 30 MB).
"""
import base64
import io
import json
import sqlite3
import time
import urllib.error
import urllib.request

BASE = "http://localhost:3000"
DB = "/home/z/my-project/db/custom.db"


def make_gif(pad_bytes: int) -> bytes:
    from PIL import Image

    frames = [
        Image.new("RGB", (96, 96), c) for c in [(255, 0, 0), (0, 255, 0), (0, 0, 255)]
    ]
    buf = io.BytesIO()
    frames[0].save(
        buf, format="GIF", save_all=True, append_images=frames[1:], duration=120, loop=0
    )
    gif = bytearray(buf.getvalue())
    # Comment extension after header(6)+LSD(7) — browsers ignore it; the
    # 0x21 0xF9 GCE scan is unaffected, so the GIF stays animated+valid.
    comment = (b"PAD" * (pad_bytes // 3 + 1))[:pad_bytes]
    block = bytearray([0x21, 0xFE])
    data = comment
    while data:
        chunk, data = data[:255], data[255:]
        block.append(len(chunk))
        block.extend(chunk)
    block.append(0x00)
    gif[13:13] = block
    return bytes(gif)


def call(method, path, body=None, token=None, timeout=120):
    req = urllib.request.Request(BASE + path, method=method, data=body)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            # lowercase keys — urllib preserves the wire case (Next sends lowercase)
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def jcall(method, path, payload=None, token=None, timeout=120):
    body = json.dumps(payload).encode() if payload is not None else None
    status, headers, raw = call(method, path, body, token, timeout)
    try:
        return status, headers, json.loads(raw or b"{}")
    except Exception:
        return status, headers, raw


print("=== 1. build padded animated GIF (~300 KB) ===")
gif = make_gif(300_000)
data_url = "data:image/gif;base64," + base64.b64encode(gif).decode()
gce = sum(1 for i in range(len(gif) - 1) if gif[i] == 0x21 and gif[i + 1] == 0xF9)
print(f"gif: {len(gif)} bytes, GCE={gce}, data url {len(data_url)} chars")
assert gce >= 2 and len(data_url) > 400_000

print("=== 2. register ===")
user = f"pro_gif_{int(time.time())}"
status, _, reg = jcall(
    "POST",
    "/api/auth/register",
    {
        "username": user,
        "password": "ProGif!Pass1",
        "displayName": "Pro GIF E2E",
        "email": f"{user}@test.local",
    },
)
assert status == 200 and reg.get("accessToken"), f"register failed: {status}"
token = reg["accessToken"]
account_id = reg["user"]["id"]
print(f"registered {user} ({account_id}), isPro={reg['user'].get('isPro')}")

print("=== 3. non-Pro: big avatar -> 413 ===")
status, _, body = jcall(
    "PATCH", "/api/auth/profile", {"avatarUrl": data_url}, token
)
assert status == 413, f"expected 413, got {status}: {str(body)[:120]}"
assert body.get("code") == "AVATAR_TOO_LARGE", body
print(f"413 AVATAR_TOO_LARGE as expected: {body.get('error')[:70]}")

print("=== 4. flip isPro in db ===")
conn = sqlite3.connect(DB)
conn.execute("UPDATE Account SET isPro = 1 WHERE id = ?", (account_id,))
conn.commit()
conn.close()
print("isPro=1")

print("=== 5. Pro: big avatar -> 200 ===")
status, _, patched = jcall(
    "PATCH", "/api/auth/profile", {"avatarUrl": data_url}, token
)
assert status == 200, f"expected 200, got {status}: {str(patched)[:120]}"
print(f"PATCH 200 (Pro), stored {len(data_url)} chars")

print("=== 6. /me is SMALL and points at the endpoint ===")
status, _, me = jcall("GET", "/api/auth/me", token=token)
assert status == 200
assert me["avatarUrl"] == f"/api/avatar/{account_id}", me["avatarUrl"][:60]
assert me["isPro"] is True
print(f"/me payload {len(json.dumps(me))} chars, avatarUrl=/api/avatar/{account_id}")

print("=== 7. endpoint serves byte-identical GIF ===")
status, headers, raw = call("GET", f"/api/avatar/{account_id}")
assert status == 200, f"endpoint: {status}"
ct = headers.get("content-type", "")
assert ct == "image/gif", ct
assert raw == gif, f"bytes differ: {len(raw)} vs {len(gif)}"
print(f"GET /api/avatar -> 200 {ct}, {len(raw)} bytes, byte-identical")

print("=== 8. max-size probe: ~30 MB GIF (body ~42 MB) -> 200 ===")
# pad must account for the sub-block length prefixes (1 byte per 255-byte
# chunk ≈ pad/255 framing) on top of the ~600-byte base structure; -128 KB
# lands the file ~7 KB UNDER 30 MB
gif30 = make_gif(30 * 1024 * 1024 - 128 * 1024)
du30 = "data:image/gif;base64," + base64.b64encode(gif30).decode()
print(f"30MB probe: file {len(gif30)} bytes, data url {len(du30)} chars")
status, _, patched = jcall("PATCH", "/api/auth/profile", {"avatarUrl": du30}, token)
assert status == 200, f"expected 200, got {status}: {str(patched)[:120]}"
status, _, me = jcall("GET", "/api/auth/me", token=token)
assert me["avatarUrl"] == f"/api/avatar/{account_id}"
status, headers, raw = call("GET", f"/api/avatar/{account_id}", timeout=120)
assert status == 200 and raw == gif30, f"{status} {len(raw)} vs {len(gif30)}"
print("30 MB avatar stored + served byte-identical")

print("=== 9. over-limit probe: ~35 MB GIF (body ~47 MB) -> 413 ===")
gif35 = make_gif(35 * 1024 * 1024)
du35 = "data:image/gif;base64," + base64.b64encode(gif35).decode()
print(f"35MB probe: file {len(gif35)} bytes, data url {len(du35)} chars")
status, _, body = jcall("PATCH", "/api/auth/profile", {"avatarUrl": du35}, token)
assert status == 413 and body.get("code") == "AVATAR_TOO_LARGE", (
    f"{status} {str(body)[:100]}"
)
print("413 AVATAR_TOO_LARGE — Next accepted the ~47 MB body, our cap rejected it")

print("=== 10. cleanup ===")
status, _, _ = jcall("PATCH", "/api/auth/profile", {"avatarUrl": None}, token)
print(f"avatar removed: {status}")
print("E2E PASS — Liner Pro 30 MB animated GIF avatars work end-to-end")
