#!/usr/bin/env python3
"""End-to-end: log in as the test account, PATCH an 8MB animated-GIF avatar
to /v1/users/me, report only the outcome (status + whether avatarUrl came
back). Credentials + token are NEVER printed."""
import base64
import json
import os
import sys
import urllib.error
import urllib.request

EMAIL = os.environ.get("TEST_EMAIL", "seekfromohio@gmail.com")
PASSWORD = os.environ["TEST_PASSWORD"]  # pass via env, never hardcode/print
BASE = "http://localhost:3000"

# 1. login via the relayed upstream /v1/auth/login
login_body = json.dumps({"email": EMAIL, "password": PASSWORD}).encode()
req = urllib.request.Request(
    f"{BASE}/v1/auth/login",
    data=login_body,
    method="POST",
    headers={"content-type": "application/json"},
)
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        login_resp = json.loads(resp.read())
except urllib.error.HTTPError as e:
    print(f"login -> HTTP {e.code}: {e.read(300).decode('utf-8','replace')}")
    sys.exit(1)

token = login_resp.get("accessToken") or (login_resp.get("user") or {}).get("accessToken")
user = login_resp.get("user", {})
print(f"login OK — user username={user.get('username')!r} isPro={user.get('isPro')} (token redacted)")
if not token:
    print("no accessToken in login response:", list(login_resp.keys()))
    sys.exit(1)

# 2. PATCH an 8MB animated-GIF avatar (base64 data URL, ~11MB body)
raw = 8 * 1024 * 1024
gif_b64 = base64.b64encode(b"\x00" * raw).decode()
data_url = f"data:image/gif;base64,{gif_b64}"
patch_body = json.dumps({"avatarUrl": data_url}).encode()
print(f"PATCH body size: {len(patch_body):,} bytes")

req = urllib.request.Request(
    f"{BASE}/v1/users/me",
    data=patch_body,
    method="PATCH",
    headers={
        "content-type": "application/json",
        "authorization": f"Bearer {token}",
    },
)
try:
    with urllib.request.urlopen(req, timeout=60) as resp:
        status = resp.status
        body = resp.read()
except urllib.error.HTTPError as e:
    status = e.code
    body = e.read()

print(f"\nPATCH /v1/users/me -> HTTP {status}")
try:
    parsed = json.loads(body)
    av = parsed.get("avatarUrl")
    if isinstance(av, str):
        # redact the data url — just report its shape
        if av.startswith("/api/avatar/"):
            print(f"avatarUrl stored -> served via {av} (byte-serving endpoint, oversized-inline path)")
        elif av.startswith("data:"):
            print(f"avatarUrl stored inline (data URL, {len(av):,} chars)")
        else:
            print(f"avatarUrl = {av[:60]!r}...")
    else:
        print(f"avatarUrl = {av!r}")
    print(f"isPro in response: {parsed.get('isPro')}")
    if "error" in parsed:
        print(f"error: {parsed.get('error')}  code: {parsed.get('code')}")
except Exception:
    print(body[:300])
