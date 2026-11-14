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
// Discord bot watchdog (24/7 self-healing)
//
// Two bots run alongside this server in the workspace, each guarded the same
// way: a fresh heartbeat file every 15s; when it goes stale and the runner
// process is gone, this watchdog — running inside the long-lived next-server
// process — respawns the bot's supervisor detached via setsid.
//
//   - liner-bot (Liner System, discord.js): liner-bot/run.sh
//   - discord-bot (Alfredo headless runner, python): discord-bot/run_forever.sh
//     (inert until alfredo.py is restored on this host)
//
// On hosts without the bot directories (production FC) both are inert.
// ---------------------------------------------------------------------------
const STALE_MS = 90_000;
const WATCHDOG_INTERVAL_MS = 30_000;
const SPAWN_COOLDOWN_MS = 60_000;

const WATCHED_BOTS = [
  {
    name: "liner-system",
    dir: "/home/z/my-project/liner-bot",
    script: "run.sh",
  },
  {
    name: "alfredo",
    dir: "/home/z/my-project/discord-bot",
    script: "run_forever.sh",
  },
] as const;

const botWatchdogStarted = new Set<string>();
const lastSpawnAt = new Map<string, number>();

function startBotWatchdog(bot: (typeof WATCHED_BOTS)[number], scriptExists: boolean): void {
  if (botWatchdogStarted.has(bot.name) || !scriptExists) return;
  botWatchdogStarted.add(bot.name);

  const timer = setInterval(() => {
    void checkAndRespawnBot(bot);
  }, WATCHDOG_INTERVAL_MS);
  // never keep the event loop alive just for the watchdog
  if (typeof timer.unref === "function") timer.unref();

  async function checkAndRespawnBot(bot: (typeof WATCHED_BOTS)[number]): Promise<void> {
    try {
      const [{ readFileSync }, nodeProcess, { spawn }] = await Promise.all([
        import("fs"),
        import("node:process"),
        import("child_process"),
      ]);

      let stale = true;
      let runnerPid: number | null = null;
      try {
        const raw = readFileSync(`${bot.dir}/bot_status.json`, "utf8");
        const s = JSON.parse(raw) as { heartbeat?: string; pid?: number };
        if (typeof s.pid === "number") runnerPid = s.pid;
        if (s.heartbeat) {
          const age = Date.now() - new Date(s.heartbeat).getTime();
          stale = !(age >= 0 && age < STALE_MS);
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
      if (now - (lastSpawnAt.get(bot.name) ?? 0) < SPAWN_COOLDOWN_MS) return;
      lastSpawnAt.set(bot.name, now);

      const child = spawn("setsid", ["bash", `${bot.dir}/${bot.script}`], {
        cwd: bot.dir,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      console.warn(
        "[liner] bot watchdog:",
        bot.name,
        "heartbeat stale — respawned",
        bot.script,
        "(pid",
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
    // watchdog is inert unless the bot script exists on this host
    try {
      const { existsSync } = await import("fs");
      for (const bot of WATCHED_BOTS) {
        startBotWatchdog(bot, existsSync(`${bot.dir}/${bot.script}`));
      }
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
    // Liner Pro boot sweep: the owner's account (jayzeyluna) is Pro forever —
    // re-flag the row on every boot so wipes / mirror restores can never
    // leave the owner without the badge. Deferred like the mail queue.
    setTimeout(() => {
      void import("@/lib/pro")
        .then(({ ensureOwnerPro }) => ensureOwnerPro())
        .catch(() => undefined);
    }, 12_000).unref();
    // dev-only: keep the deploy-time production mirror cache armed (see
    // src/lib/prodMirrorWatch.ts — prevents the empty-seed wipe deploys)
    try {
      void import("@/lib/prodMirrorWatch").then(({ startProdMirrorCacheWatcher }) =>
        startProdMirrorCacheWatcher(),
      );
    } catch {
      // never break server bootstrap
    }
  }
}
