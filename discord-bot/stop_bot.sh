#!/bin/bash
# Stops the Alfredo bot + supervisor cleanly.
BOT_DIR="$(cd "$(dirname "$0")" && pwd)"

pkill -f "run_forever.sh" 2>/dev/null
pkill -f "python3 run_headless.py" 2>/dev/null
rm -f "$BOT_DIR/bot.pid"
echo "alfredo stopped"
