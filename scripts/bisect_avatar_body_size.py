#!/usr/bin/env python3
"""Bisect the body-size threshold where /v1/users/me PATCH starts returning
400 "Invalid body." (i.e. req.arrayBuffer() fails). Tests localhost only."""
import base64
import json
import urllib.error
import urllib.request

URL = "http://localhost:3000/v1/users/me"
SIZES_MB = [0.1, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 10]


def probe(mb: float) -> int:
    raw = int(mb * 1024 * 1024)
    b64 = base64.b64encode(b"\x00" * raw).decode()
    body = json.dumps({"avatarUrl": f"data:image/gif;base64,{b64}"}).encode()
    req = urllib.request.Request(
        URL,
        data=body,
        method="PATCH",
        headers={
            "content-type": "application/json",
            "authorization": "Bearer fake",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code


prev = None
for mb in SIZES_MB:
    status = probe(mb)
    body_kb = int(mb * 1024)
    marker = ""
    if prev is not None and prev < 400 <= status:
        marker = "  <-- threshold crossed here"
    print(f"{mb:>5} MB body ({body_kb:>7} KB) -> HTTP {status}{marker}")
    prev = status
