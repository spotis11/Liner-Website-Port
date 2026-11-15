#!/usr/bin/env python3
"""Reproduce the /v1/users/me PATCH 400 for an 8MB animated GIF avatar.

The client sends the GIF as a base64 data URL in the PATCH body. An 8MB GIF
inflates to ~10.7MB of base64. upstreamProfilePATCH checks the body BEFORE the
auth validation hop, so a huge body + a fake bearer tells us where the body
read fails:
  - 400 "Invalid body."  -> body read returned null (size limit / truncation)
  - 401 / 403            -> body read succeeded (size NOT the issue; auth is)
  - 413 AVATAR_TOO_LARGE -> body read + auth + avatar cap all passed (Pro cap hit)
"""
import json
import urllib.request

# Simulate an 8MB GIF: 8 * 1024 * 1024 raw bytes -> base64 (~10.67M chars).
RAW_BYTES = 8 * 1024 * 1024
import base64
fake_gif_b64 = base64.b64encode(b"\x00" * RAW_BYTES).decode()
data_url = f"data:image/gif;base64,{fake_gif_b64}"
body = json.dumps({"avatarUrl": data_url}).encode()
print(f"PATCH body size: {len(body):,} bytes ({len(body)/1024/1024:.2f} MB)")
print(f"data URL length: {len(data_url):,} chars")


def probe(label: str, url: str) -> None:
    req = urllib.request.Request(
        url,
        data=body,
        method="PATCH",
        headers={
            "content-type": "application/json",
            "authorization": "Bearer fake-token-to-isolate-body-read",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            status, payload = resp.status, resp.read(400)
    except urllib.error.HTTPError as e:
        status, payload = e.code, e.read(400)
    print(f"\n=== {label} -> HTTP {status} ===")
    try:
        print(payload.decode("utf-8", "replace"))
    except Exception:
        print(payload)


probe("localhost :3000", "http://localhost:3000/v1/users/me")
probe("LIVE liner-music.space-z.ai", "https://liner-music.space-z.ai/v1/users/me")
