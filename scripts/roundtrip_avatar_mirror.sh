#!/usr/bin/env bash
# Round-trip test: avatar upload -> mirror flush -> db wipe (fresh container
# simulation) -> reboot -> does the UpstreamProfile row survive restore?
set -u
cd /home/z/my-project

echo "=== 1. stop server, wipe db + mirror, boot fresh (simulated container) ==="
if [ -f /tmp/liner-prod.pid ] && kill -0 "$(cat /tmp/liner-prod.pid)" 2>/dev/null; then
  kill "$(cat /tmp/liner-prod.pid)"; sleep 2
fi
rm -f db/custom.db db/custom.db-journal db/db-mirror.json db/db-mirror-seed.json
nohup node .next/standalone/server.js > /tmp/liner-prod.log 2>&1 &
echo $! > /tmp/liner-prod.pid
sleep 4
curl -s -o /dev/null -w "boot -> HTTP %{http_code}\n" http://localhost:3000

echo ""
echo "=== 2. login + upload 8MB GIF (upstream overlay path) ==="
TEST_PASSWORD='Yourgy88' python3 scripts/e2e_avatar_serve_cycle.py 2>&1 | grep -E "login OK|PATCH|GET /api/avatar|cleanup|after clear" | head -8
