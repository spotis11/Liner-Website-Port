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
    // running.sh free plan has no alwaysOn (Pro-only) — containers sleep after
    // 30 idle minutes, so every visit after a quiet half hour pays a full
    // cold boot. An external self-ping through the edge counts as traffic and
    // keeps the container warm, the same way the hosted bots stay fresh.
    // Gated on WEB_SELF_PING_URL (a running.sh service variable) so the
    // sandbox dev server never pings production.
    {
      const selfPingUrl = process.env.WEB_SELF_PING_URL?.trim();
      if (selfPingUrl) {
        const tick = async () => {
          try {
            const res = await fetch(selfPingUrl, { method: "GET" });
            console.log(`[liner] self-ping ${res.status}`);
          } catch (error) {
            console.warn(
              "[liner] self-ping failed:",
              error instanceof Error ? error.message : error,
            );
          }
        };
        setTimeout(tick, 15_000).unref();
        setInterval(tick, 5 * 60 * 1000).unref();
      }
    }
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
