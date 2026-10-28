#!/usr/bin/env python3
"""Spawn a static file server fully detached (same pattern as spawn_prod_webserver.py)."""
import os, subprocess, sys, time

PORT = sys.argv[1] if len(sys.argv) > 1 else "8899"
ROOT = sys.argv[2] if len(sys.argv) > 2 else "/home/z/my-project/scripts/soundwave-demo"
PIDFILE = f"/home/z/my-project/scripts/static-{PORT}.pid"
LOG = f"/home/z/my-project/scripts/static-{PORT}.log"

def main():
    proc = subprocess.Popen(
        ["python3", "-m", "http.server", PORT, "--bind", "0.0.0.0"],
        cwd=ROOT,
        stdout=open(LOG, "ab"),
        stderr=open(LOG, "ab"),
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    with open(PIDFILE, "w") as f:
        f.write(str(proc.pid))
    print(f"spawned pid {proc.pid} on :{PORT} serving {ROOT}")
    time.sleep(1.5)
    if proc.poll() is not None:
        print(f"exited early: {proc.returncode}")
        sys.exit(1)

if __name__ == "__main__":
    main()
