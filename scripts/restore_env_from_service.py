#!/usr/bin/env python3
"""Restore workspace .env keys that were lost in the sandbox rebuild.

Source: the encrypted service variables on running.sh (same values the
deploy script would re-set anyway). Values are never printed — only key
names, before and after. DATABASE_URL is skipped: the workspace .env keeps
its local sandbox path (the deploy script overrides it to the container
path at upload time).
"""
import json
import re
import sys
from pathlib import Path

ENV_PATH = Path("/home/z/my-project/.env")
VARS_DUMP = Path("/tmp/webvars.json")

RESTORE = [
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_PUBLIC_BASE",
    "DISCORD_REDIRECT_URI",
    "DB_MIRROR_EXPORT_KEY",
    "SMTP_USER",
    "SMTP_PASS",
    "ADMIN_GATE_SECRET",
    "MAIL_PUBLIC_BASE_URL",
]

def key_names(env_text: str) -> list[str]:
    return re.findall(r"^([A-Z_]+)=", env_text, re.M)

def main() -> int:
    data = json.loads(VARS_DUMP.read_text())["data"]
    values = {}
    for item in data:
        name = item.get("name")
        value = item.get("value")
        if name in RESTORE and value:
            values[name] = value

    env_text = ENV_PATH.read_text()
    if not env_text.endswith("\n"):
        env_text += "\n"

    existing = set(key_names(env_text))
    added = []
    for name in RESTORE:
        if name not in values:
            continue
        if name in existing:
            continue
        env_text += f"{name}={values[name]}\n"
        added.append(name)

    ENV_PATH.write_text(env_text)
    print("added:", ", ".join(added) if added else "(none)")
    print("now present:", ", ".join(sorted(set(key_names(ENV_PATH.read_text())))))
    return 0

if __name__ == "__main__":
    sys.exit(main())
