#!/usr/bin/env python3
"""Clean up: clear the test avatar left on the test account by the e2e probe
(the null-byte fake GIF). Token/password never printed."""
import json
import os
import sys
import urllib.error
import urllib.request

EMAIL = os.environ.get("TEST_EMAIL", "seekfromohio@gmail.com")
PASSWORD = os.environ["TEST_PASSWORD"]
BASE = "http://localhost:3000"

req = urllib.request.Request(
    f"{BASE}/v1/auth/login",
    data=json.dumps({"email": EMAIL, "password": PASSWORD}).encode(),
    method="POST",
    headers={"content-type": "application/json"},
)
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        login = json.loads(r.read())
except urllib.error.HTTPError as e:
    print(f"login -> HTTP {e.code}"); sys.exit(1)
token = login.get("accessToken")
if not token:
    print("no token"); sys.exit(1)

req = urllib.request.Request(
    f"{BASE}/v1/users/me",
    data=json.dumps({"avatarUrl": None}).encode(),
    method="PATCH",
    headers={"content-type": "application/json", "authorization": f"Bearer {token}"},
)
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        status, body = r.status, r.read()
except urllib.error.HTTPError as e:
    status, body = e.code, e.read()
parsed = json.loads(body)
print(f"clear avatar -> HTTP {status}  avatarUrl={parsed.get('avatarUrl')!r}")
