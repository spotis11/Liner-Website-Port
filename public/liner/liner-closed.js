/* Liner closure notice v1 — see scripts/inject_closed_notice.py
 *
 * Owner request (2026-11-27): the z.ai space (liner-music.space-z.ai) shows a
 * PERMANENT full-screen notice that Liner has been closed due to copyright
 * and leaking, as stated in the official Liner README on GitHub. No close
 * button, no dismissal — sign-in and every other interaction sit blocked
 * behind it.
 *
 * Hostname gate: this file ships inside the shared shell, but it only mounts
 * on the z.ai space (plus localhost/127.0.0.1 for local verification).
 * running.sh never receives it — running_deploy_web.sh strips the loader tag
 * and the file from its staging copy — and even if it ever did, the gate
 * below keeps it invisible there.
 */
(function () {
  try {
    var host = location.hostname || "";
    var onZai = host === "space-z.ai" || host.endsWith(".space-z.ai");
    var onDev =
      host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "";
    if (!onZai && !onDev) return;

    var CLOSED_TITLE = "Liner — Closed";

    // While the closure is up, the "we're moving to running.sh" migration
    // announcement must never appear on this host. The loader tag for that
    // announcement sits AFTER this script's tag, so setting its localStorage
    // flag here runs first and it never mounts; the sweep below is the belt
    // to those braces.
    try {
      localStorage.setItem("liner_migration_announcement_v3", "never");
    } catch (e) {}

    var cssText = [
      "#liner-closed-overlay{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;background:#0d0d10;font-family:'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;text-align:center;user-select:none;-webkit-user-select:none;}",
      "#liner-closed-overlay *{box-sizing:border-box;}",
      ".lc-logo{width:clamp(72px,14vw,104px);height:auto;border-radius:24%;border:1px solid rgba(255,255,255,.08);box-shadow:0 12px 40px rgba(0,0,0,.55);}",
      ".lc-wordmark{margin-top:18px;color:#fff;font-size:clamp(15px,2.6vw,19px);font-weight:800;letter-spacing:.42em;padding-left:.42em;}",
      ".lc-badge{margin-top:14px;display:inline-block;border-radius:999px;padding:6px 14px;font-size:clamp(10px,1.8vw,12px);font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#f87171;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.35);}",
      ".lc-head{margin:18px 0 0;max-width:560px;color:#fff;font-size:clamp(19px,4.2vw,27px);font-weight:700;line-height:1.4;letter-spacing:.02em;}",
      ".lc-src{margin:14px 0 0;max-width:480px;color:#a1a1aa;font-size:clamp(12.5px,2.2vw,14.5px);line-height:1.6;}",
      ".lc-note{margin:26px 0 0;max-width:480px;color:#63636b;font-size:clamp(11.5px,2vw,13px);line-height:1.6;}",
      "@media (max-width:420px){#liner-closed-overlay{padding:20px;}}",
    ].join("\n");

    function mount() {
      var lm = document.getElementById("lm-overlay");
      if (lm && lm.parentNode) lm.parentNode.removeChild(lm);
      if (document.getElementById("liner-closed-overlay")) return;

      var style = document.createElement("style");
      style.id = "liner-closed-style";
      style.textContent = cssText;
      document.head.appendChild(style);

      var overlay = document.createElement("div");
      overlay.id = "liner-closed-overlay";
      overlay.setAttribute("role", "alertdialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "Liner has been closed");
      overlay.innerHTML = [
        '<img class="lc-logo" src="/liner/icon.png" alt="Liner logo" draggable="false">',
        '<div class="lc-wordmark">LINER</div>',
        '<div class="lc-badge">Permanently closed</div>',
        "<h1 class=\"lc-head\">LINER HAS BEEN CLOSED DUE TO COPYRIGHT AND LEAKING</h1>",
        "<p class=\"lc-src\">As stated in the official Liner README on GitHub.</p>",
        "<p class=\"lc-note\">Sign-in and playback are disabled. This notice is permanent and cannot be dismissed.</p>",
      ].join("");
      document.body.appendChild(overlay);
      document.title = CLOSED_TITLE;
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mount, { once: true });
    } else {
      mount();
    }

    // Re-assert every second: nothing on this host may remove the notice,
    // cover it, or title over it. There is deliberately no way to dismiss it.
    setInterval(function () {
      var overlay = document.getElementById("liner-closed-overlay");
      if (!overlay) {
        mount();
      } else if (overlay.style.zIndex !== "2147483647") {
        overlay.style.zIndex = "2147483647";
      }
      var lm = document.getElementById("lm-overlay");
      if (lm && lm.parentNode) lm.parentNode.removeChild(lm);
      if (document.title !== CLOSED_TITLE) document.title = CLOSED_TITLE;
    }, 1000);
  } catch (e) {
    /* never throw into the host app */
  }
})();
