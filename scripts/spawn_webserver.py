#!/usr/bin/env python3
"""Spawn the Next.js dev server fully detached (double-fork + setsid),
mirroring how the Alfredo bot survives process reaping.
The child writes its own pid to scripts/webserver.pid for the watchdog."""
import os
import sys
import time

PIDFILE = "/home/z/my-project/scripts/webserver.pid"
LOG = "/home/z/my-project/dev.log"


def is_running(pid: int) -> bool:
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            cmd = f.read().decode(errors="replace")
        return "next" in cmd or "bun" in cmd or "node" in cmd
    except OSError:
        return False


def main() -> None:
    # If a healthy server is already up, do nothing
    if os.path.exists(PIDFILE):
        try:
            pid = int(open(PIDFILE).read().strip())
            if is_running(pid):
                print(f"webserver already running (pid {pid})")
                return
        except (ValueError, OSError):
            pass

    # First fork
    try:
        if os.fork() > 0:
            return  # parent exits
    except OSError as e:
        sys.exit(f"fork #1 failed: {e}")
    os.setsid()

    # Second fork
    try:
        if os.fork() > 0:
            os._exit(0)
    except OSError as e:
        os._exit(f"fork #2 failed: {e}")

    # Detached daemon child
    os.chdir("/home/z/my-project")
    with open(PIDFILE, "w") as f:
        f.write(str(os.getpid()))

    # Redirect std streams to the dev log
    fd = os.open(LOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    os.dup2(fd, 1)
    os.dup2(fd, 2)
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0)

    os.execvp("bun", ["bun", "run", "dev"])


if __name__ == "__main__":
    main()
