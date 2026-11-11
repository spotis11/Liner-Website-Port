#!/usr/bin/env python3
"""Boot a detached scratch auth server on :3100 with a seeded Discord-linked
(passwordless) account — for UI verification of the DISCORD_ONLY messaging.
Fully isolated: scratch db in /tmp/authfix-ui, never touches workspace/prod."""
import os
import sqlite3
import subprocess
import sys
import datetime

SCRATCH = "/tmp/authfix-ui"
os.makedirs(SCRATCH + "/db", exist_ok=True)
DB = SCRATCH + "/db/custom.db"

# fresh db every run
for suffix in ("", "-wal", "-shm"):
    try:
        os.remove(DB + suffix)
    except FileNotFoundError:
        pass

# let prisma create the schema on boot; seed AFTER the server is up
env = dict(os.environ)
env.update({
    "NODE_ENV": "production",
    "PORT": "3100",
    "HOSTNAME": "127.0.0.1",
    "DATABASE_URL": f"file:{DB}",
    "DB_MIRROR_EXPORT_KEY": "ui-scratch-key",
})

# copy the workspace standalone server's env file so it boots identically
log = open(SCRATCH + "/server.log", "ab")
proc = subprocess.Popen(
    ["node", ".next/standalone/server.js"],
    cwd="/home/z/my-project",
    env=env,
    stdout=log,
    stderr=log,
    start_new_session=True,
)
print(f"spawned scratch pid {proc.pid}")

# wait for boot (schema created lazily by ensureDbReady on first request)
import time
import urllib.request
for _ in range(40):
    try:
        with urllib.request.urlopen("http://127.0.0.1:3100/api/health", timeout=2) as r:
            if r.status == 200:
                break
    except Exception:
        time.sleep(1)
else:
    sys.exit("scratch server did not become healthy")

# seed the Discord-linked account (no passwordHash) exactly like production's
db = sqlite3.connect(DB)
now = datetime.datetime.now(datetime.UTC).isoformat()
db.execute(
    "INSERT INTO Account (id, email, username, displayName, discordId, isGuest,"
    " isPublic, showActivity, showHistory, showLikedTracks,"
    " participateLeaderboards, createdAt, updatedAt)"
    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ("dc_ui_1", "seekfromohio@gmail.com", "thearchyexpunged",
     "thearchyexpunged", "1083656421964513331", 0, 1, 1, 1, 1, 1, now, now),
)
db.commit()
db.close()
print("seeded Discord-linked account thearchyexpunged (no password)")
