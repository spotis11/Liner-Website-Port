#!/bin/bash
# Alfredo bot service entrypoint.
#
# Launched by the platform's mini-services boot flow (start.sh runs
# `bun run dev` in mini-services/alfredo-bot) and reusable by hand.
#
# Behavior:
#   - bot already running -> idle as a healthy placeholder (never run twice)
#   - otherwise           -> run the supervisor loop (auto-restart on crash)
PYTHON=/home/z/.venv/bin/python3
BOT_DIR=/home/z/my-project/discord-bot
cd "$BOT_DIR"
mkdir -p logs

# hosted migration: Alfredo runs on running.sh (see .hosted) — never start here
if [ -f "${BOT_DIR}/.hosted" ]; then
  echo "[alfredo-service] .hosted marker — Alfredo lives on running.sh now"
  exit 0
fi

if pgrep -f "run_headless.py" > /dev/null 2>&1; then
  echo "[alfredo-service] bot already running — idling as placeholder"
  exec sleep infinity
fi

# honor the token override if provided, otherwise alfredo.py's default
export DISCORD_BOT_TOKEN="${DISCORD_BOT_TOKEN:-}"

exec bash "$BOT_DIR/run_forever.sh"
