#!/bin/bash
# Stop the Liner System bot + its supervisor.
pkill -f "liner-bot/run.sh" 2>/dev/null
pkill -f "node.*index\.js --liner-system-bot" 2>/dev/null
sleep 1
if pgrep -f "node.*index\.js --liner-system-bot" > /dev/null 2>&1; then
  echo "still running — force killing"
  pkill -9 -f "node.*index\.js --liner-system-bot" 2>/dev/null
fi
echo "Liner System bot stopped"
