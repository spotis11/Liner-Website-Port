#!/usr/bin/env python3
"""Spawn the Next.js PRODUCTION standalone server fully detached."""
import os, subprocess, time

PIDFILE = "/home/z/my-project/scripts/webserver.pid"
LOG = "/home/z/my-project/prod.log"

def main():
    env = dict(os.environ)
    env.update({
        "NODE_ENV": "production",
        "PORT": "3000",
        "HOSTNAME": "0.0.0.0",
    })
    with open(LOG, "ab") as log:
        proc = subprocess.Popen(
            ["node", ".next/standalone/server.js"],
            cwd="/home/z/my-project",
            env=env,
            stdout=log,
            stderr=log,
            start_new_session=True,
        )
    with open(PIDFILE, "w") as f:
        f.write(str(proc.pid))
    print(f"spawned pid {proc.pid}")

if __name__ == "__main__":
    main()
