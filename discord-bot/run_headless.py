"""
Headless 24/7 runner for alfredo.py (the Alfredo portable Discord bot).

Runs the EXACT same bot logic as the tkinter desktop app, minus the GUI:

  - token: DISCORD_BOT_TOKEN env var, or alfredo.py's DEFAULT_BOT_TOKEN
  - a stub "app" object absorbs every GUI callback the bot thread makes
    (online status, server list, DM log, prefix/status variables, image labels)
  - heartbeat + state are written to bot_status.json (consumed by the
    website's /api/discord-bot/status route so the bot is visible on the web)
  - logs go to logs/bot.log (rotating) and stdout (captured by supervisor)

Exit code 1 => the supervisor (run_forever.sh) restarts the bot after a
short cooldown. A pidfile guard prevents accidental double instances.
"""

import importlib.util
import json
import logging
import logging.handlers
import os
import signal
import sys
import threading
import time

BOT_DIR = os.path.dirname(os.path.abspath(__file__))
PIDFILE = os.path.join(BOT_DIR, "bot.pid")
STATUS_PATH = os.path.join(BOT_DIR, "bot_status.json")
LOG_PATH = os.path.join(BOT_DIR, "logs", "bot.log")

STATUS_LOCK = threading.Lock()
LAST_HEARTBEAT = time.time()
STATUS = {
    "status": "starting",
    "pid": os.getpid(),
    "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "last_ready_at": None,
    "bot_username": None,
    "guild_count": 0,
    "heartbeat": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}


def write_status():
    global LAST_HEARTBEAT
    LAST_HEARTBEAT = time.time()
    with STATUS_LOCK:
        STATUS["heartbeat"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        tmp = STATUS_PATH + ".tmp"
        try:
            with open(tmp, "w") as f:
                json.dump(STATUS, f, indent=2)
            os.replace(tmp, STATUS_PATH)
        except Exception as e:
            logging.error("status write failed: %s", e)


def setup_logging():
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    fh = logging.handlers.RotatingFileHandler(
        LOG_PATH, maxBytes=8 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    fh.setFormatter(fmt)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    root.addHandler(fh)
    root.addHandler(sh)

    # capture "Bot is ONLINE! Logged in as <name>" into the web status file
    import re

    class _IdentityCapture(logging.Handler):
        _RE = re.compile(r"Logged in as (.+?)\s*$")

        def emit(self, record):
            m = self._RE.search(record.getMessage())
            if m:
                STATUS["bot_username"] = m.group(1).strip()
                write_status()

    root.addHandler(_IdentityCapture())


class _StubConfigLabel:
    """Absorbs `.config(...)` calls the bot makes on GUI preview labels."""

    def config(self, **_kw):
        pass

    def configure(self, **_kw):
        pass


class _StubVar:
    def __init__(self, value=""):
        self._value = value

    def get(self, *_a, **_k):
        return self._value

    def set(self, value):
        self._value = value


class _StubEntry:
    def __init__(self, value=""):
        self._value = value

    def get(self):
        return self._value


class HeadlessApp:
    """
    Drop-in replacement for the tkinter DiscordBotApp instance. BotThread only
    touches the members below (verified by inventorying every `self.app.`
    reference in alfredo.py).
    """

    def __init__(self):
        # `root.after(0, fn)` marshals callbacks onto the Tk thread; headless
        # we simply execute them inline (they only touch stubs / logging).
        self.root = self
        self.cmd_prefix_var = _StubVar(".")
        self.offline_mode_var = _StubVar(False)
        self.dm_autoreply_var = _StubVar("")
        self.dm_reply_entry = _StubEntry("")
        self.weather_api_entry = _StubEntry("")
        self._server_img_label = _StubConfigLabel()
        self._dm_img_label = _StubConfigLabel()
        self._message_image_map = {}

    def after(self, _delay_ms, fn, *args):
        try:
            fn(*args)
        except Exception:
            logging.exception("headless stub callback failed")

    def set_online_status(self, online):
        STATUS["status"] = "online" if online else "offline"
        if online:
            STATUS["last_ready_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        write_status()
        logging.info("bot online status -> %s", online)

    def populate_servers(self, guilds_data):
        try:
            STATUS["guild_count"] = len(guilds_data or {})
        except Exception:
            STATUS["guild_count"] = 0
        write_status()
        logging.info("connected to %d server(s)", STATUS["guild_count"])

    def log_dm_message(self, message):
        try:
            author = getattr(getattr(message, "author", None), "name", "?")
            content = str(getattr(message, "content", "") or "")[:300]
            logging.info("[DM] %s: %s", author, content)
        except Exception:
            pass


def _another_instance_running():
    try:
        with open(PIDFILE) as f:
            other = int(f.read().strip())
        if other == os.getpid():
            return False
        os.kill(other, 0)  # signal 0 = existence check
        return True
    except (FileNotFoundError, ValueError):
        return False
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def main():
    setup_logging()
    logging.info("Alfredo headless runner starting (pid %d)", os.getpid())

    if _another_instance_running():
        logging.info("another headless instance is already running — exiting")
        return 0

    with open(PIDFILE, "w") as f:
        f.write(str(os.getpid()))
    write_status()

    def _handle_term(_sig, _frm):
        logging.info("shutdown signal received")
        STATUS["status"] = "stopping"
        write_status()
        sys.exit(0)

    signal.signal(signal.SIGTERM, _handle_term)
    signal.signal(signal.SIGINT, _handle_term)

    # -- hosted runtime (running.sh container) -------------------------------
    # /health on $PORT for the platform health check + a 4-minute self-ping
    # that defeats free-tier idle sleep (an outbound gateway socket does not
    # count as traffic). Inert locally: RUNNING_* markers exist only there.
    if os.environ.get("RUNNING_HEALTH_CHECK") or os.environ.get("RUNNING_PUBLIC_DOMAIN"):
        import http.server

        port = int(os.environ.get("PORT", "3000"))

        class _Health(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/health":
                    age = max(0, int(time.time() - LAST_HEARTBEAT))
                    online = (
                        STATUS.get("status") == "online" and age < 90
                    )
                    body = json.dumps({
                        "ok": online,
                        "online": online,
                        "status": STATUS.get("status"),
                        "bot": STATUS.get("bot_username"),
                        "guildCount": STATUS.get("guild_count"),
                        "startedAt": STATUS.get("started_at"),
                        "lastReadyAt": STATUS.get("last_ready_at"),
                        "heartbeatAgeSec": age,
                    }).encode()
                    # strict gate: 200 only while the Discord gateway is
                    # actually ready — a crash-looping container must never
                    # pass the platform health check on boot flapping
                    self.send_response(200 if online else 503)
                    self.send_header("content-type", "application/json")
                    self.send_header("content-length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                else:
                    self.send_response(204)
                    self.end_headers()

            def log_message(self, *_a):
                pass

        server = http.server.ThreadingHTTPServer(("0.0.0.0", port), _Health)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        logging.info("health server on 0.0.0.0:%d", port)
        if os.environ.get("RUNNING_PUBLIC_DOMAIN"):
            self_url = "https://%s/health" % os.environ["RUNNING_PUBLIC_DOMAIN"]

            def _ping():
                import urllib.request

                while True:
                    time.sleep(240)
                    try:
                        urllib.request.urlopen(self_url, timeout=10)
                    except Exception:
                        pass

            threading.Thread(target=_ping, daemon=True).start()
            logging.info("keepalive self-ping -> %s every 4m", self_url)

    # -- tkinter availability shim -------------------------------------------
    # alfredo.py imports tkinter at module level, but headless runs never touch
    # the GUI. If the tk shared libs are absent (slim images), install a
    # permissive stub: every attribute resolves to a subclassable stub class,
    # so `class App(tk.Frame)` bodies still execute — and are simply never used.
    try:
        import tkinter  # noqa: F401
        import tkinter.ttk  # noqa: F401
        import tkinter.filedialog  # noqa: F401
        import tkinter.messagebox  # noqa: F401
        import tkinter.scrolledtext  # noqa: F401
    except Exception:
        import types

        class _StubWidget:
            """Anything-goes stand-in: callable, subclassable, nestable."""

            def __init__(self, *_a, **_k):
                pass

            def __call__(self, *_a, **_k):
                return _StubWidget()

            def __getattr__(self, name):
                if name.startswith("__"):
                    raise AttributeError(name)
                return _StubWidget

        class _StubTkModule(types.ModuleType):
            def __getattr__(self, name):
                if name.startswith("__"):
                    raise AttributeError(name)
                return _StubWidget

        for _mod_name in (
            "tkinter",
            "tkinter.ttk",
            "tkinter.filedialog",
            "tkinter.messagebox",
            "tkinter.scrolledtext",
        ):
            sys.modules[_mod_name] = _StubTkModule(_mod_name)
        logging.warning("tkinter libs unavailable — stubbed for headless run")

    # -- load alfredo.py as a module (its __main__ GUI block is skipped) ----
    spec = importlib.util.spec_from_file_location(
        "alfredo", os.path.join(BOT_DIR, "alfredo.py")
    )
    alfredo = importlib.util.module_from_spec(spec)
    sys.modules["alfredo"] = alfredo
    spec.loader.exec_module(alfredo)  # module-level diagnostics print once

    token = os.environ.get("DISCORD_BOT_TOKEN", "").strip() or alfredo.DEFAULT_BOT_TOKEN
    if not token:
        logging.error("no bot token available (env DISCORD_BOT_TOKEN / DEFAULT_BOT_TOKEN)")
        return 1

    # -- heartbeat thread keeps bot_status.json fresh for the web route ----
    def _heartbeat():
        while True:
            time.sleep(15)
            write_status()

    threading.Thread(target=_heartbeat, daemon=True).start()

    # -- launch the bot thread (same class the GUI uses) -------------------
    app = HeadlessApp()
    bot_thread = alfredo.BotThread(token, app)
    bot_thread.start()
    logging.info("BotThread started — connecting to Discord...")

    # BotThread is a daemon thread; keep the supervisor process alive and
    # exit(1) if the bot thread dies so run_forever.sh restarts us.
    while True:
        time.sleep(5)
        if not bot_thread.is_alive():
            logging.error("BotThread died — runner exiting for supervisor restart")
            STATUS["status"] = "offline"
            write_status()
            return 1


if __name__ == "__main__":
    sys.exit(main())
