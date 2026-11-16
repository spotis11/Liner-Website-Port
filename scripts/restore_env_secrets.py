#!/usr/bin/env python3
"""Rebuild the gitignored .env after a workspace rebuild wipes it.

Recovers every value that is legitimately recoverable:
  DATABASE_URL        — fixed sandbox path (boot flow already writes it)
  DISCORD_CLIENT_ID   — public value, read from FC's OAuth start redirect
  SMTP_USER           — the MAIL_FROM address, committed in .env.production

Everything else (SMTP_PASS, DISCORD_CLIENT_SECRET, DB_MIRROR_EXPORT_KEY,
LINER_SERVICE_EMAIL/PASS) was only ever in .env and is LOST — it stays ABSENT
so the runtime degrades exactly as designed (PKCE-only OAuth, mail logged
warning, mirror sync off) instead of running on empty strings.
Values are never printed here.
"""
import re
import sys

ENV_PATH = "/home/z/my-project/.env"

DISCORD_CLIENT_ID = "1552617559675633664"  # public: FC /api/auth/discord/start redirect
SMTP_USER = "linersystem22@gmail.com"      # from MAIL_FROM in committed .env.production

current = {}
try:
    for line in open(ENV_PATH):
        m = re.match(r"^([A-Z_]+)=(.*)$", line.strip())
        if m:
            current[m.group(1)] = m.group(2).strip().strip('"')
except FileNotFoundError:
    pass

current.setdefault("DATABASE_URL", "file:/home/z/my-project/db/custom.db")
current["DISCORD_CLIENT_ID"] = DISCORD_CLIENT_ID
current["SMTP_USER"] = SMTP_USER

order = ["DATABASE_URL", "DISCORD_CLIENT_ID", "SMTP_USER",
         "# --- lost in the 2026-11-16 workspace rebuild; re-supply when available:",
         "# SMTP_PASS=", "# DISCORD_CLIENT_SECRET=", "# DB_MIRROR_EXPORT_KEY=",
         "# LINER_SERVICE_EMAIL=", "# LINER_SERVICE_PASS="]

with open(ENV_PATH, "w") as f:
    for item in order:
        if item.startswith("#"):
            f.write(item + "\n")
        else:
            f.write(f"{item}={current.get(item, '')}\n")

print("restored keys:", ", ".join(k for k in order if not k.startswith("#")))
print("still missing (optional-by-design): SMTP_PASS, DISCORD_CLIENT_SECRET, DB_MIRROR_EXPORT_KEY, LINER_SERVICE_EMAIL/PASS")
