#!/usr/bin/env python3
"""Full upload->serve cycle on localhost: PATCH an 8MB GIF avatar, then GET
the /api/avatar/:id URL the response points at. Reports statuses only; the
token/password are never printed."""
import base64
import json
import os
import sys
import urllib.error
import urllib.request

EMAIL = os.environ.get("TEST_EMAIL", "seekfromohio@gmail.com")
PASSWORD = os.environ["TEST_PASSWORD"]
BASE = "http://localhost:3000"


def call(method: str, path: str, body: bytes | None = None, token: str | None = None):
    headers = {"content-type": "application/json"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        f"{BASE}{path}", data=body, method=method, headers=headers
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


# 1. login
status, _, body = call(
    "POST", "/v1/auth/login", json.dumps({"email": EMAIL, "password": PASSWORD}).encode()
)
if status != 200:
    print(f"login -> HTTP {status}: {body[:200].decode('utf-8','replace')}"); sys.exit(1)
login = json.loads(body)
token = login.get("accessToken")
user = login.get("user", {})
print(f"login OK — username={user.get('username')!r} isPro={user.get('isPro')}")

# 2. PATCH an 8MB GIF
raw = 8 * 1024 * 1024
gif_b64 = base64.b64encode(b"\x00" * raw).decode()
status, _, body = call(
    "PATCH", "/v1/users/me", json.dumps({"avatarUrl": f"data:image/gif;base64,{gif_b64}"}).encode(), token
)
print(f"\nPATCH /v1/users/me -> HTTP {status}")
av = json.loads(body).get("avatarUrl", "")
if status != 200 or not isinstance(av, str) or not av.startswith("/api/avatar/"):
    print(f"unexpected avatarUrl: {av!r}"); sys.exit(1)
print(f"avatarUrl -> {av}  (oversized-inline rewrite)")

# 3. GET the served avatar URL — the step that 404s for the user
status, headers, body = call("GET", av)
print(f"\nGET {av} -> HTTP {status}")
print(f"content-type: {headers.get('content-type')}  content-length: {headers.get('content-length')}")
if status == 200:
    print(f"served {len(body):,} bytes; first bytes are base64 GIF payload: {body[:8]!r}")
else:
    print(f"body: {body[:200].decode('utf-8','replace')}")

# 4. cleanup — clear avatar, then confirm the GET now 404s (row cleared)
status, _, body = call("PATCH", "/v1/users/me", json.dumps({"avatarUrl": None}).encode(), token)
print(f"\ncleanup PATCH avatarUrl=null -> HTTP {status}  avatarUrl={json.loads(body).get('avatarUrl')!r}")
status, _, body = call("GET", av)
print(f"GET {av} after clear -> HTTP {status} (expected 404 — row gone)")
