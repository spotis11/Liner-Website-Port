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

# never start twice (marker argv is part of the runner's cmdline)
if pgrep -f "node.*index\.js --liner-system-bot" > /dev/null 2>&1; then
  echo "[supervisor] Liner System bot already running — nothing to do"
  exit 0
fi
# second guard: even while node is down (crash-loop window) only one supervisor
mkdir -p bot-data
if [ -f bot-data/supervisor.pid ] && kill -0 "$(cat bot-data/supervisor.pid 2>/dev/null)" 2>/dev/null; then
  echo "[supervisor] another supervisor already on duty — nothing to do"
  exit 0
fi
echo $$ > bot-data/supervisor.pid

echo "[supervisor] $(date -u +%FT%TZ) loop started (pid $$)" >> logs/supervisor.log
while true; do
  echo "[supervisor] $(date -u +%FT%TZ) launching Liner System bot" >> logs/supervisor.log
  node index.js --liner-system-bot >> logs/bot.log 2>&1
  code=$?
  echo "[supervisor] $(date -u +%FT%TZ) bot exited code=$code — restarting in 5s" >> logs/supervisor.log
  sleep 5
done
