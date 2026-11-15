#!/bin/bash
# Liner System anchored keeper — the SINGLE entry point for keeping the bot on
# duty 24/7, including across sandbox resets (cron keepalive bootstraps this).
#
#   bootstrap (cron): cd liner-bot && flock -n bot-data/anchored.lock -c 'setsid nohup bash ./anchored.sh >/dev/null 2>&1 &'
#   stop:             bash ./stop.sh && kill $(cat bot-data/keeper.pid) 2>/dev/null
#
# Guarantees:
# - only ONE supervisor + ONE node instance ever run (no duplicate announcements)
# - bot-data/heartbeat is refreshed while the bot's own heartbeat (bot_status.json)
#   is fresh — cron keepalives read this file's age
# - restarts within ~20s of a dead/hung bot

BOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BOT_DIR" || exit 1
mkdir -p bot-data logs data

# already on duty? (pid file + process liveness)
if [ -f bot-data/keeper.pid ]; then
  KPID=$(cat bot-data/keeper.pid 2>/dev/null)
  [ -n "$KPID" ] && kill -0 "$KPID" 2>/dev/null && exit 0
fi
echo $$ > bot-data/keeper.pid

log() { echo "[anchored] $(date -u +%FT%TZ) $*" >> bot-data/keeper.log; }
log "keeper on duty (pid $$)"

while true; do
  # 1) heartbeat mirror: fresh bot_status.json (written every 15s by index.js)
  #    -> fresh bot-data/heartbeat for the cron keepalive checks
  if [ -f bot_status.json ]; then
    age=$(( $(date +%s) - $(stat -c %Y bot_status.json 2>/dev/null || echo 0) ))
    if [ "$age" -lt 60 ]; then
      touch bot-data/heartbeat
    elif pgrep -f "node.*index\.js --liner-system-bot" >/dev/null 2>&1; then
      # process alive but heartbeat stale >= 60s: give it one more cycle,
      # then hard-restart below at >120s (handled on the next iteration)
      :
    fi
  fi

  stale=$(( $(date +%s) - $(stat -c %Y bot_status.json 2>/dev/null || echo 0) ))

  # 2) dead bot -> restart (kill any stray supervisors first: exactly one)
  if ! pgrep -f "node.*index\.js --liner-system-bot" >/dev/null 2>&1; then
    log "bot process missing — restarting supervisor"
    pkill -f "liner-bot/run.sh" 2>/dev/null
    sleep 1
    setsid nohup bash ./run.sh >/dev/null 2>&1 &
    sleep 10
  # 3) hung bot (alive but no status update for >120s) -> hard restart
  elif [ "$stale" -gt 120 ]; then
    log "bot hung (status age ${stale}s) — hard restart"
    pkill -f "node.*index\.js --liner-system-bot" 2>/dev/null
    pkill -f "liner-bot/run.sh" 2>/dev/null
    sleep 2
    setsid nohup bash ./run.sh >/dev/null 2>&1 &
    sleep 10
  fi

  sleep 20
done
