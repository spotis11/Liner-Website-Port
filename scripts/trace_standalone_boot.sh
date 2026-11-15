#!/usr/bin/env bash
# Precisely track the standalone server boot: launch detached, poll every 1s
# for 30s recording (alive?, port listening?, exit code/signal), then print
# the timeline + boot log + any OOM evidence.
set -u
cd /home/z/my-project

pkill -f 'standalone/server.js' 2>/dev/null || true
sleep 1
LOG=/tmp/sb_trace.log
rm -f "$LOG"

# Fully detach: setsid + redirect all fds.
setsid env PORT=3943 HOSTNAME=127.0.0.1 NODE_ENV=production \
  node .next/standalone/server.js \
  </dev/null >"$LOG" 2>&1 &
NPID=$!

echo "launched detached, pid=$NPID"
echo "time,alive,port_log"
bound_at=""
died_at=""
exit_code=""
for i in $(seq 1 30); do
  sleep 1
  if kill -0 "$NPID" 2>/dev/null; then
    alive="yes"
    # check port
    if ss -ltn 2>/dev/null | grep -q 3943; then
      pl="LISTENING"
      [ -z "$bound_at" ] && bound_at="$i"
    else
      pl="no"
    fi
  else
    alive="NO"
    pl="-"
    # capture exit status via wait (won't work for setsid child, but try)
    [ -z "$died_at" ] && died_at="$i"
  fi
  echo "${i}s,$alive,$pl"
  if [ "$alive" = "NO" ]; then
    break
  fi
done

# final exit status
wait "$NPID" 2>/dev/null
exit_code=$?

echo ""
echo "=== summary ==="
echo "bound_at=${bound_at:-never}"
echo "died_at=${died_at:-still-alive-or-not-captured}"
echo "exit_code=$exit_code"

echo ""
echo "=== boot log (full, sanitized) ==="
sed 's/\x1b\[[0-9;]*m//g' "$LOG" 2>/dev/null | head -100
echo "--- log bytes: $(wc -c < "$LOG" 2>/dev/null) ---"

echo ""
echo "=== OOM / kill evidence (dmesg + journal) ==="
(dmesg 2>/dev/null | grep -iE 'killed process|out of memory|oom' | tail -10) || echo "(dmesg unavailable)"
echo "--- /var/log/messages OOM ---"
(grep -iE 'oom|killed process' /var/log/messages 2>/dev/null | tail -5) || echo "(no /var/log/messages)"

# cleanup
kill -9 "$NPID" 2>/dev/null || true
pkill -f 'standalone/server.js' 2>/dev/null || true
exit 0
