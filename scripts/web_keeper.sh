#!/bin/bash
# Web anchored keeper — the SINGLE entry point for keeping the Liner website
# (:3000) on duty, including across sandbox resets (cron keepalive bootstraps
# this; the sandbox recycle kills the node process but files survive).
#
#   bootstrap (cron): cd /home/z/my-project && flock -n .web-keeper.lock -c 'setsid nohup bash scripts/web_keeper.sh >> /tmp/web-keeper.log 2>&1 &'
#   stop:             kill $(cat /tmp/liner-prod.pid) && pkill -f web_keeper.sh
#
# Guarantees:
# - only ONE server instance ever runs (pid-file + process liveness check)
# - restarts the standalone build within ~1 poll interval of a dead server
# - every action is logged to /tmp/web-keeper.log for post-mortems

cd /home/z/my-project || exit 1

# already on duty? (pid file + process liveness + real HTTP answer)
if [ -f /tmp/liner-prod.pid ]; then
  WPID=$(cat /tmp/liner-prod.pid 2>/dev/null)
  if [ -n "$WPID" ] && kill -0 "$WPID" 2>/dev/null; then
    curl -s -o /dev/null --max-time 5 http://127.0.0.1:3000/api/health && exit 0
    # process alive but not answering — kill it so the restart below fixes it
    kill "$WPID" 2>/dev/null; sleep 2
  fi
fi

# no healthy server: start the current standalone build
nohup node .next/standalone/server.js >> /tmp/liner-prod.log 2>&1 &
echo $! > /tmp/liner-prod.pid
sleep 3
CODE=$(curl -s -o /dev/null --max-time 10 -w "%{http_code}" http://127.0.0.1:3000/api/health || echo 000)
echo "[web-keeper] $(date -u +%FT%TZ) restarted server pid=$(cat /tmp/liner-prod.pid) health=HTTP $CODE"
