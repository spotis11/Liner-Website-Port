#!/usr/bin/env bash
# Start the Next.js standalone production server on :3000 so Caddy (:81 ->
# :3000) has a live upstream. This is what .zscripts/start.sh does in the
# packaged container; run it here when the :3000 server has died (the live
# site then 502s because Caddy's upstream is unreachable).
#
# Detached via setsid + full fd redirection so the server survives the tool
# call that launched it (reparented to init, not in the caller's process group).
set -u
cd /home/z/my-project

# Do NOT pkill -f 'standalone/server.js' here — that pattern matches this
# script's own command line and would suicide the shell. Only free :3000 if
# something is actually squatting on it, and do it by port, not by name.
if ss -ltn 2>/dev/null | grep -q ':3000 '; then
  echo "ℹ️  :3000 already listening — leaving it alone."
  ss -ltnp 2>/dev/null | grep ':3000 '
  exit 0
fi

SERVER_JS=".next/standalone/server.js"
if [ ! -f "$SERVER_JS" ]; then
  echo "❌ $SERVER_JS missing — run 'npm run build' first."
  exit 1
fi

LOG=/tmp/liner-prod.log
rm -f "$LOG"

setsid env PORT=3000 HOSTNAME=0.0.0.0 NODE_ENV=production \
  node "$SERVER_JS" \
  </dev/null >"$LOG" 2>&1 &
disown

echo "🚀 launched standalone prod on :3000 (log: $LOG)"

# wait up to 15s for the port
for i in $(seq 1 30); do
  if ss -ltn 2>/dev/null | grep -q ':3000 '; then
    echo "✅ :3000 listening after ${i}x0.5s"
    break
  fi
  sleep 0.5
done

ss -ltn 2>/dev/null | grep ':3000 ' || echo "⚠️  :3000 still not listening"

# quick self-probe
code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:3000/api/maintenance" 2>/dev/null || echo "ERR")
echo "self-probe /api/maintenance -> $code"

exit 0
