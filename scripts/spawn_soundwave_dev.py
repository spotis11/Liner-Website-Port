#!/usr/bin/env python3
"""Spawn the soundwave (connorklee0) Vite DEV server fully detached."""
import os, subprocess, sys, time

PIDFILE = "/home/z/my-project/scripts/soundwave-dev.pid"
LOG = "/home/z/my-project/scripts/soundwave-dev.log"
APP = "/home/z/my-project/external/soundwave"

def main():
    env = dict(os.environ)
    env.update({
        "NODE_ENV": "development",
        "HOST": "0.0.0.0",
    })
    with open(LOG, "ab") as log:
        proc = subprocess.Popen(
            ["npx", "vite", "--host", "0.0.0.0", "--port", "5173", "--strictPort"],
            cwd=APP,
            env=env,
            stdout=log,
            stderr=log,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    with open(PIDFILE, "w") as f:
        f.write(str(proc.pid))
    print(f"spawned pid {proc.pid}")
    time.sleep(3)
    if proc.poll() is not None:
        print(f"process exited early with code {proc.returncode}")
        sys.exit(1)

if __name__ == "__main__":
    main()
