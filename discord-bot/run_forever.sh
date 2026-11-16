#!/bin/bash
# Alfredo Discord bot — 24/7 supervisor.
# Restarts the headless runner whenever it exits (crash, token hiccup, etc.).
#
#   start:   setsid nohup bash /home/z/my-project/discord-bot/run_forever.sh >/dev/null 2>&1 &
#   stop:    bash /home/z/my-project/discord-bot/stop_bot.sh
#   status:  cat /home/z/my-project/discord-bot/bot_status.json

BOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BOT_DIR"
# hosted migration: Alfredo runs on running.sh (see .hosted) — every local
# respawn path (watchdog, service boot, manual) must stand down.
if [ -f "${BOT_DIR}/.hosted" ]; then
  echo "[supervisor] .hosted marker — Alfredo lives on running.sh now"
  exit 0
fi
# absolute venv python (has discord.py/yt-dlp); fall back to PATH python3
PYTHON=/home/z/.venv/bin/python3
[ -x "$PYTHON" ] || PYTHON=python3

# never start twice (matches any runner invocation)
if pgrep -f "run_headless.py" > /dev/null 2>&1; then
  echo "[supervisor] bot already running — nothing to do"
  exit 0
fi

echo "[supervisor] $(date -u +%FT%TZ) loop started (pid $$)" >> logs/supervisor.log
while true; do
  echo "[supervisor] $(date -u +%FT%TZ) launching headless runner" >> logs/supervisor.log
  "$PYTHON" run_headless.py >> logs/supervisor.log 2>&1
  code=$?
  echo "[supervisor] $(date -u +%FT%TZ) runner exited code=$code — restarting in 10s" >> logs/supervisor.log
  sleep 10
done
