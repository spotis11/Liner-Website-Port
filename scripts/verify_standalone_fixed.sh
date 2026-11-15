#!/usr/bin/env bash
# Boot the standalone server detached, probe the key endpoints + favicon + CSP,
# then kill it — all in one call so the harness doesn't tear it down mid-test.
set -u
cd /home/z/my-project

pkill -f 'standalone/server.js' 2>/dev/null || true
sleep 1

setsid env PORT=3944 HOSTNAME=127.0.0.1 NODE_ENV=production \
  node .next/standalone/server.js \
  </dev/null >/tmp/sb_verify.log 2>&1 &
NPID=$!

# hard cap
( sleep 20 && kill -9 "$NPID" 2>/dev/null; pkill -f 'standalone/server.js' 2>/dev/null ) &
KP=$!

# wait up to 12s for port
ready=0
for i in $(seq 1 24); do
  if ss -ltn 2>/dev/null | grep -q 3944; then ready=1; break; fi
  kill -0 "$NPID" 2>/dev/null || break
  sleep 0.5
done

echo "ready=$ready (port 3944)"
echo ""
echo "=== probes ==="
for ep in /favicon.ico /liner/icon.png /api/maintenance /api/announcements/current /api/showcase /v1/me /api/moderation/check / "/liner/index.html"; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:3944$ep" 2>/dev/null || echo "ERR")
  echo "  $ep -> $code"
done

echo ""
echo "=== served root HTML: CSP frame-src count + favicon links ==="
HTML=$(curl -sS --max-time 5 "http://127.0.0.1:3944/" 2>/dev/null)
echo "frame-src occurrences: $(printf '%s' "$HTML" | grep -o 'frame-src' | wc -l)"
printf '%s' "$HTML" | grep -o 'frame-src[^;"'\'']*' | head
echo "icon links:"
printf '%s' "$HTML" | grep -o '<link[^>]*icon[^>]*>' | head

echo ""
echo "=== /favicon.ico content-type ==="
curl -sS -D - --max-time 5 "http://127.0.0.1:3944/favicon.ico" -o /dev/null 2>/dev/null | grep -i 'content-type\|content-length\|HTTP/'

echo ""
echo "=== boot log ==="
sed 's/\x1b\[[0-9;]*m//g' /tmp/sb_verify.log 2>/dev/null | head -40

# cleanup
kill "$KP" 2>/dev/null || true
kill -9 "$NPID" 2>/dev/null || true
pkill -f 'standalone/server.js' 2>/dev/null || true
sleep 1
echo "=== final proc check ==="
pgrep -af 'standalone/server.js' | grep -v 'bash -c' || echo "(clean)"
exit 0
