# Alfredo bot — 24/7 hosting

The bot (`Mr Alfredo#3597`) runs headless: same `alfredo.py` logic as the
desktop GUI, no tkinter needed. The GUI's callbacks are absorbed by
`run_headless.py`'s stub app object.

## How it runs here (web workspace)

Three layers keep the bot online 24/7:

1. **Boot service** — `mini-services/alfredo-bot/` is started by the
   platform's own `/start.sh` on every workspace boot (`bun run dev` →
   `discord-bot/service.sh` → supervisor loop). Platform-owned processes
   survive; manually spawned ones get reaped by the sandbox within minutes.
2. **Supervisor loop** — `run_forever.sh` restarts the runner 10s after any
   crash for as long as the process tree lives.
3. **Server watchdog** — the Next.js `instrumentation.ts` runs a check every
   30s: stale `bot_status.json` heartbeat + dead pid ⇒ respawn via setsid.
   Verified end-to-end (watchdog resurrected a dead bot in ~40s).

```
boot service   : mini-services/alfredo-bot/package.json  ("dev" script)
supervisor     : discord-bot/run_forever.sh              (restart on crash)
runner         : discord-bot/run_headless.py             (loads alfredo.py, stubs the GUI)
bot logic      : discord-bot/alfredo.py                  (unmodified copy)
watchdog       : src/instrumentation.ts                  (30s heartbeat check, respawn)
status file    : discord-bot/bot_status.json             (15s heartbeat)
web visibility : /api/discord-bot/status                 (Next.js route)
logs           : discord-bot/logs/bot.log + logs/supervisor.log
```

Commands:

```bash
# start by hand (normally unnecessary — boot service + watchdog cover it)
setsid nohup bash /home/z/my-project/discord-bot/run_forever.sh >/dev/null 2>&1 &

# stop
bash /home/z/my-project/discord-bot/stop_bot.sh

# live logs
tail -f /home/z/my-project/discord-bot/logs/supervisor.log

# quick status
cat /home/z/my-project/discord-bot/bot_status.json
```

Check online status from the web: open `/api/discord-bot/status` on the
website host. `{"online":true,"bot":"Mr Alfredo#3597","guildCount":24,...}`.

Notes:

- After creating the mini-service entry, ONE workspace restart is needed for
  the platform to adopt it at boot (manually spawned daemons are reaped by
  the sandbox within minutes — platform-owned ones are not).
- Heavy `bun run build` runs can spike memory (4GB box) and OOM the bot;
  the supervisor/watchdog bring it back automatically within ~40s.
- The bot's IP-logger/OAuth web server binds port 8080.

## Hosting it elsewhere (true independent 24/7)

`requirements.txt` + `Dockerfile` are ready. Any host that runs the
container with `--restart unless-stopped` (or its equivalent) gives the bot
a 24/7 home. Free-ish options, best first:

1. **Oracle Cloud "Always Free" VPS** — genuinely free forever (ARM, 4 OCPU /
   24 GB tier), full Linux VM. Run the container there with systemd.
2. **Koyeb / Railway** — push the repo, deploy the Dockerfile as a service;
   both support long-running websocket processes. Set
   `DISCORD_BOT_TOKEN` in the service's env vars (never commit it).
3. **Fly.io** — same Dockerfile, `fly launch`, `fly deploy`.
4. **Any cheap VPS** (Hetzner ~€4/mo, Contabo, etc.) — most reliable.

The runner reads the token from `DISCORD_BOT_TOKEN` first, falling back to
the value baked into `alfredo.py` — on external hosts, always use the env
var and keep the file private (anyone with the file has the token; rotate it
in the Discord Developer Portal if it has ever been shared).
