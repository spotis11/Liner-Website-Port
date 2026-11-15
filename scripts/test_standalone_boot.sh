#!/usr/bin/env bash
# Boot the Next.js standalone server locally, probe it, then kill it — all in
# one process so the harness doesn't tear down the server mid-test.
set -u
cd /home/z/my-project

pkill -f 'standalone/server.js' 2>/dev/null || true
sleep 1
rm -f /tmp/standalone-boot.log

# Fully detach: setsid + redirect ALL fds (stdin from /dev/null, stdout+stderr
# to a file) so node never shares a pipe with this script's parent.
setsid env PORT=3939 HOSTNAME=127.0.0.1 NODE_ENV=production \
  node .next/standalone/server.js \
  </dev/null >/tmp/standalone-boot.log 2>&1 &
SRV_PID=$!

# Hard cap: 25s, then force-kill no matter what.
( sleep 25 && kill -9 "$SRV_PID" 2>/dev/null && pkill -f 'standalone/server.js' 2>/dev/null ) &
KILLER_PID=$!

# Wait up to 15s for the port to answer.
up=0
for i in $(seq 1 30); do
  if ! kill -0 "$SRV_PID" 2>/dev/null; then
    echo "❌ server process died after ${i}x0.5s"
    break
  fi
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 2 "http://127.0.0.1:3939/api/maintenance" 2>/dev/null || echo "000")
  if [ "$code" != "000" ] && [ "$code" != "" ]; then
    up=1
    echo "✅ server answering after ${i}x0.5s (api/maintenance -> $code)"
    break
  fi
  sleep 0.5
done

echo "=== process alive? ==="
kill -0 "$SRV_PID" 2>/dev/null && echo "ALIVE pid=$SRV_PID" || echo "DEAD pid=$SRV_PID"

echo "=== probes ==="
for ep in /api/maintenance /api/announcements/current /api/showcase /v1/me /api/moderation/check /; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:3939$ep" 2>/dev/null || echo "ERR")
  echo "  $ep -> $code"
done

echo "=== boot log (first 80 lines) ==="
head -80 /tmp/standalone-boot.log
echo "=== boot log tail (last 40 lines) ==="
tail -40 /tmp/standalone-boot.log

# Cleanup
kill "$KILLER_PID" 2>/dev/null || true
kill -9 "$SRV_PID" 2>/dev/null || true
pkill -f 'standalone/server.js' 2>/dev/null || true
sleep 1
echo "=== final proc check ==="
pgrep -af 'standalone/server.js' || echo "(no standalone server processes remain)"
exit 0
