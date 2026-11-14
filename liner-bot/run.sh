#!/bin/bash
# Liner System bot — 24/7 supervisor.
# Restarts index.js whenever it exits (crash, network blip, token hiccup).
#
#   start:   setsid nohup bash /home/z/my-project/liner-bot/run.sh >/dev/null 2>&1 &
#   stop:    bash /home/z/my-project/liner-bot/stop.sh
#   status:  cat /home/z/my-project/liner-bot/bot_status.json

BOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BOT_DIR"
mkdir -p logs data
PYTHON=""

# never start twice (matches any running node index.js from this bot dir)
if pgrep -f "liner-bot.*index\.js" | grep -v "^$$\$" > /dev/null 2>&1; then
  echo "[supervisor] Liner System bot already running — nothing to do"
  exit 0
fi

echo "[supervisor] $(date -u +%FT%TZ) loop started (pid $$)" >> logs/supervisor.log
while true; do
  echo "[supervisor] $(date -u +%FT%TZ) launching Liner System bot" >> logs/supervisor.log
  node index.js >> logs/bot.log 2>&1
  code=$?
  echo "[supervisor] $(date -u +%FT%TZ) bot exited code=$code — restarting in 5s" >> logs/supervisor.log
  sleep 5
done
