#!/usr/bin/env python3
"""Flip maintenance on the LIVE deployment via the owner admin cookie.

Mints the liner_web_admin cookie exactly like signAdminCookie() does, using
the HMAC secret from SystemKey.admin_gate_secret in db/custom.db — the same
row the live deployment's packaged DB carries. POSTs {enabled: ...} to
/api/maintenance on the live site. The secret and cookie value are NEVER
printed.

Usage:
  python3 scripts/flip_live_maintenance.py off    # release the live wall
  python3 scripts/flip_live_maintenance.py on     # raise the live wall
"""
import base64
import hashlib
import hmac
import json
import sqlite3
import sys
import time
import urllib.error
import urllib.request

LIVE = "https://liner-music.space-z.ai"
DB = "/home/z/my-project/db/custom.db"
USERNAME = "jayzeyluna"


def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in ("on", "off"):
        print("usage: flip_live_maintenance.py on|off")
        sys.exit(2)
    enable = sys.argv[1] == "on"

    con = sqlite3.connect(DB)
    row = con.execute(
        "SELECT value FROM SystemKey WHERE key='admin_gate_secret'"
    ).fetchone()
    con.close()
    if not row:
        print("ERROR: admin_gate_secret missing from local db")
        sys.exit(1)
    secret = row[0].encode()

    payload = json.dumps(
        {"u": USERNAME, "exp": int(time.time() * 1000) + 30 * 24 * 3600 * 1000}
    )
    body = b64url(payload.encode())
    sig = b64url(hmac.new(secret, body.encode(), hashlib.sha256).digest())
    cookie = f"v1.{body}.{sig}"

    req = urllib.request.Request(
        f"{LIVE}/api/maintenance",
        data=json.dumps({"enabled": enable}).encode(),
        headers={
            "Content-Type": "application/json",
            "Cookie": f"liner_web_admin={cookie}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            print("POST status:", r.status)
            print("POST body:", r.read().decode()[:300])
    except urllib.error.HTTPError as e:
        print("POST status:", e.code)
        print("POST body:", e.read().decode()[:300])
        sys.exit(1)


if __name__ == "__main__":
    main()
