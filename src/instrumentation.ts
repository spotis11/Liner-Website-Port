// Liner web port: server bootstrap hook.
//
// YouTube's TV endpoints (www.youtube.com/tv, the kabuki base script) answer
// with ~24 KB response header blocks — a 12.9 KB content-security-policy plus
// a 7.4 KB report-only header on top of the usual cookie set. Node's undici
// defaults to a 16 KB response-header cap and drops the connection with
// UND_ERR_HEADERS_OVERFLOW ("fetch failed"), which intermittently killed the
// YouTube TV sign-in bootstrap (device code never loaded). The Electron
// desktop build never hit this because Chromium has no such small cap.
//
// npm-undici's setGlobalDispatcher registers through Symbol.for, which the
// Node built-in global fetch used by the proxy routes also honours.
//
// IMPORTANT: the production deployment (Alibaba FC) runs the standalone
// server via `bun server.js`, and npm-undici cannot load under Bun
// (webidl.util.markAsUncloneable is Node-only). A throwing instrumentation
// hook used to leave the server half-initialised: every /api/* route answered
// 500 "Internal Server Error" while static files kept serving. Bun's own
// fetch implementation has no 16 KB undici header cap, so skipping the
// dispatcher there is safe — the raised cap is a Node-only concern.
//
// ---------------------------------------------------------------------------
// Alfredo Discord bot watchdog (24/7 self-healing)
//
// The headless bot (discord-bot/run_headless.py under run_forever.sh) runs
// alongside this server in the workspace. If it dies (crash, OOM spike during
// a build, sandbox hiccup), this watchdog — running inside the long-lived
// next-server process — notices the stale heartbeat and respawns it detached
// via setsid. On hosts without discord-bot/ (production FC) it is inert.
// ---------------------------------------------------------------------------
const BOT_DIR = "/home/z/my-project/discord-bot";
const BOT_HEARTBEAT_STALE_MS = 90_000;
const BOT_WATCHDOG_INTERVAL_MS = 30_000;
const BOT_SPAWN_COOLDOWN_MS = 60_000;

let botWatchdogStarted = false;
let lastBotSpawnAt = 0;

function startBotWatchdog(botDirExists: boolean): void {
  if (botWatchdogStarted || !botDirExists) return;
  botWatchdogStarted = true;

  const timer = setInterval(() => {
    void checkAndRespawnBot();
  }, BOT_WATCHDOG_INTERVAL_MS);
  // never keep the event loop alive just for the watchdog
  if (typeof timer.unref === "function") timer.unref();

  async function checkAndRespawnBot(): Promise<void> {
    try {
      const [{ readFileSync }, nodeProcess, { spawn }] = await Promise.all([
        import("fs"),
        import("node:process"),
        import("child_process"),
      ]);

      let stale = true;
      let runnerPid: number | null = null;
      try {
        const raw = readFileSync(`${BOT_DIR}/bot_status.json`, "utf8");
        const s = JSON.parse(raw) as { heartbeat?: string; pid?: number };
        if (typeof s.pid === "number") runnerPid = s.pid;
        if (s.heartbeat) {
          const age = Date.now() - new Date(s.heartbeat).getTime();
          stale = !(age >= 0 && age < BOT_HEARTBEAT_STALE_MS);
        }
      } catch {
        stale = true; // no status file yet
      }

      if (!stale) return;

      // runner process still alive (e.g. during long startup)? leave it alone
      if (runnerPid) {
        try {
          nodeProcess.kill(runnerPid, 0);
          return;
        } catch {
          // pid gone — fall through to respawn
        }
      }

      const now = Date.now();
      if (now - lastBotSpawnAt < BOT_SPAWN_COOLDOWN_MS) return;
      lastBotSpawnAt = now;

      const child = spawn(
        "setsid",
        ["bash", `${BOT_DIR}/run_forever.sh`],
        { cwd: BOT_DIR, detached: true, stdio: "ignore" },
      );
      child.unref();
      console.warn(
        "[liner] bot watchdog: heartbeat stale — respawned run_forever.sh (pid",
        child.pid ?? "?",
        ")",
      );
    } catch (error) {
      console.warn(
        "[liner] bot watchdog check failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.warn("[liner] instrumentation register() running (nodejs)");
    try {
      const { setGlobalDispatcher, Agent } = await import("undici");
      setGlobalDispatcher(new Agent({ maxHeaderSize: 256 * 1024 }));
    } catch (error) {
      console.warn(
        "[liner] undici dispatcher unavailable in this runtime; using the built-in fetch as-is:",
        error instanceof Error ? error.message : error,
      );
    }
    // watchdog is inert unless the bot directory exists on this host
    try {
      const { existsSync } = await import("fs");
      startBotWatchdog(existsSync(`${BOT_DIR}/run_forever.sh`));
    } catch {
      // never let the watchdog break server bootstrap
    }
    // self-healing mail queue: once the SMTP credentials in .env work, every
    // welcome/ban mail that previously failed goes out on the next boot.
    // Deferred so it never slows or breaks server bootstrap; unref'd so it
    // never keeps the process alive just for itself.
    setTimeout(() => {
      void import("@/lib/mailer")
        .then(({ retryFailedTransactionalEmails }) =>
          retryFailedTransactionalEmails(),
        )
        .catch(() => undefined);
    }, 15_000).unref();
  }
}
