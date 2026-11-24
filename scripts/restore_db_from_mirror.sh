#!/bin/bash
# Rebuild db/custom.db from the LIVE production mirror using the app's own
# boot-restore path (src/lib/db.ts: a fresh db + db-mirror-seed.json next to
# it -> full restore incl. sessions). The deploy Dockerfile overwrites the
# container db with the staged one on every deploy, so the staged copy MUST
# be the freshest live state, never the stale workspace file.
set -euo pipefail

ROOT=/home/z/my-project
STANDALONE=$ROOT/.next/standalone
WORK=/tmp/restoredb
PORT=3111
MIRROR=${1:-/tmp/prod-mirror.json}

[ -s "$MIRROR" ] || { echo "FATAL: mirror $MIRROR missing" >&2; exit 1; }
[ -f "$STANDALONE/server.js" ] || { echo "FATAL: no standalone build — run npm run build" >&2; exit 1; }

rm -rf "$WORK" && mkdir -p "$WORK"
# seed lives NEXT TO the sqlite file (db.ts dbSeedMirrorPath)
cp "$MIRROR" "$WORK/db-mirror-seed.json"

cd "$STANDALONE"
DATABASE_URL="file:$WORK/custom.db" PORT=$PORT HOSTNAME=127.0.0.1 \
  NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
  node server.js > "$WORK/boot.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT

for i in $(seq 1 30); do
  sleep 1
  if curl -sf -m 2 "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1; then
    echo "healthy after ${i}s"
    break
  fi
  if ! kill -0 $PID 2>/dev/null; then
    echo "FATAL: server died during boot:" >&2
    tail -20 "$WORK/boot.log" >&2
    exit 1
  fi
done

grep -oE "restored [0-9]+[^,]*" "$WORK/boot.log" | head -3 || true

python3 - "$WORK/custom.db" <<'PYEOF'
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
for t in ("account", "session", "accountPlaylist", "playlistTrack", "systemKey"):
    try:
        n = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"{t}: {n}")
    except Exception as e:
        print(f"{t}: ERR {e}")
PYEOF

kill $PID 2>/dev/null || true
wait $PID 2>/dev/null || true
trap - EXIT
cp "$WORK/custom.db" "$ROOT/db/custom.db"
echo "restored db -> $ROOT/db/custom.db ($(stat -c%s "$ROOT/db/custom.db") bytes)"
