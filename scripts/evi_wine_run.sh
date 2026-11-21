#!/bin/bash
# Run Evi.exe under user-space Wine on a virtual display and capture screenshots.
# Usage: evi_wine_run.sh <exe-or-exe-dir> [screenshot-prefix] [wait-seconds]
set -u
WINE_ROOT=/home/z/my-project/work/evi-extract/wine-11.22-amd64-wow64
WINE="$WINE_ROOT/bin/wine"
export WINEPREFIX=/home/z/my-project/work/evi-wine
export WINEDEBUG=-all
export DISPLAY=:99
EXE="${1:-}"
PREFIX_SHOTS="${2:-/tmp/evi-shots/wine}"
WAIT="${3:-25}"

if [ ! -f "$EXE" ]; then echo "no exe: $EXE" >&2; exit 1; fi

# Xvfb on :99
if ! pgrep -f "Xvfb :99" > /dev/null; then
  (Xvfb :99 -screen 0 1320x690x24 +extension GLX +render -noreset > /tmp/xvfb.log 2>&1 &)
  sleep 2
fi

mkdir -p "$(dirname "$PREFIX_SHOTS")"

# launch detached
cd "$(dirname "$EXE")"
nohup "$WINE" "$EXE" > /tmp/wine-app.log 2>&1 &
APP_PID=$!
echo "launched pid $APP_PID; waiting ${WAIT}s"
sleep "$WAIT"

# screenshot
ffmpeg -y -loglevel error -f x11grab -video_size 1320x690 -i :99 -frames:v 1 "${PREFIX_SHOTS}-t${WAIT}s.png"
echo "shot: ${PREFIX_SHOTS}-t${WAIT}s.png"
ls -la "${PREFIX_SHOTS}"*.png 2>/dev/null | tail -2
echo "--- wine log tail ---"
tail -5 /tmp/wine-app.log
