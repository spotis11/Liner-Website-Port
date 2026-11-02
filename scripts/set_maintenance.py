#!/usr/bin/env python3
"""Flip the website-port maintenance wall on/off.

Writes SystemKey.web_maintenance_v1 in db/custom.db — the same switch that
POST /api/maintenance (owner-only) and src/proxy.ts read, so one flip moves
the server wall, the API 503 gates and the client mirror together.

Usage:
  python3 scripts/set_maintenance.py on            # enable with default reasons
  python3 scripts/set_maintenance.py on "r1" "r2"  # enable with custom reasons
  python3 scripts/set_maintenance.py off           # release the wall
"""
import json
import sqlite3
import sys
from datetime import datetime, timezone

DB = "/home/z/my-project/db/custom.db"
KEY = "web_maintenance_v1"

DEFAULT_REASONS = [
    "The upstream Liner API is blocking sign-in and registration at its Cloudflare edge (HTTP 403) in some regions — even correct credentials fail",
    "Music playback and the rest of the service are disabled while the upstream block is in effect",
    "This is not a problem with your account, password, device, or network",
]


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in ("on", "off"):
        print("usage: set_maintenance.py on|off [reason1 reason2 ...]")
        sys.exit(2)
    enabled = sys.argv[1] == "on"
    if enabled and len(sys.argv) > 2:
        reasons = [r for r in sys.argv[2:] if r.strip()]
    else:
        reasons = DEFAULT_REASONS if enabled else []
    state = {
        "enabled": enabled,
        "reasons": reasons,
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    con = sqlite3.connect(DB)
    try:
        con.execute(
            'INSERT INTO "SystemKey"("key","value","updatedAt") VALUES(?,?,CURRENT_TIMESTAMP) '
            'ON CONFLICT("key") DO UPDATE SET value=excluded.value, updatedAt=CURRENT_TIMESTAMP',
            (KEY, json.dumps(state)),
        )
        con.commit()
    finally:
        con.close()
    print(json.dumps(state, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
