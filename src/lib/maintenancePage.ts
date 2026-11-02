import type { MaintenanceState } from "@/lib/maintenance";

/**
 * Standalone, zero-dependency HTML for the server-side maintenance wall.
 *
 * This page is served DIRECTLY by src/proxy.ts (status 503) for every
 * non-API route while maintenance is enabled — before any Liner SPA code
 * can load — so neither a normal refresh nor a hard refresh can reach the
 * sign-in page or the player. It mirrors the in-app MaintenanceScreen
 * (liner-app/src/features/maintenance) so both walls look identical:
 * Liner logo + wordmark, amber "under repair" card, possible reasons,
 * "Please come back later."
 *
 * Everything is inlined (logo SVG, CSS, release-check script) on purpose:
 * the page must render even if every other route on the server is walled,
 * and it must never depend on Google Fonts or other third-party origins.
 *
 * The tiny inline script keeps the promise made in the retry note: it polls
 * /api/maintenance (which stays reachable during maintenance by design) and
 * reloads the tab the moment maintenance ends. Until then the server keeps
 * answering 503 — the client can only watch, never bypass.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The exact copy used by the in-app MaintenanceScreen (en.json). */
const COPY = {
  title: "Currently on Maintenance!",
  body: "Liner is having problems right now. Possible reasons:",
  footer: "Please come back later.",
  retryNote:
    "This page checks every 30 seconds and lets you back in the moment maintenance ends. Nothing you do in the meantime can get past it — not even a hard refresh.",
  stamp: "MAINTENANCE",
} as const;

/** The Liner glyph (liner-app/src/assets/logo.svg), white, 45x35. */
const LOGO_SVG = `<svg width="45" height="35" viewBox="0 0 45 35" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M4 0C1.79086 0 0 1.79086 0 4V27.2081C0 30.2751 3.30951 32.201 5.97608 30.6859L13.9629 26.1478C16.6295 24.6327 19.939 26.5587 19.939 29.6256V31C19.939 33.2091 21.7298 35 23.939 35H41C43.2091 35 45 33.2091 45 31V27.5586C45 25.3494 43.2091 23.5586 41 23.5586H35.2783C33.0691 23.5586 31.2783 21.7677 31.2783 19.5586V10.0519C31.2783 6.98497 27.9688 5.05899 25.3022 6.57411L17.3153 11.1121C14.6488 12.6273 11.3393 10.7013 11.3393 7.63433V4C11.3393 1.79086 9.54843 0 7.33929 0H4Z" fill="white"/></svg>`;

/** Hammer badge icon (lucide-style stroke hammer, matches the app's icon). */
const HAMMER_SVG = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ffc555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/></svg>`;

const CLOCK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

export function renderMaintenancePage(state: MaintenanceState): string {
  const reasons = state.reasons.filter((r) => r.trim().length > 0);
  const reasonItems =
    reasons.length > 0
      ? `<ul class="reasons">${reasons
          .map(
            (reason) =>
              `<li><span class="dot" aria-hidden="true"></span><span>${escapeHtml(reason)}</span></li>`,
          )
          .join("")}</ul>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Liner — ${COPY.title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  :root { color-scheme: dark; }
  body {
    min-height: 100vh;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: #09090b;
    color: #fff;
    font-family: "Montserrat", "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .backdrop { position: fixed; inset: 0; pointer-events: none; }
  .backdrop::before {
    content: "";
    position: absolute; inset: 0;
    background:
      radial-gradient(560px 420px at 18% 8%, rgba(255,176,32,0.09), transparent 65%),
      radial-gradient(640px 480px at 85% 90%, rgba(120,120,255,0.07), transparent 60%),
      radial-gradient(900px 640px at 50% 45%, rgba(255,255,255,0.045), transparent 70%);
  }
  .watermark {
    position: absolute; left: 50%; top: 50%;
    width: min(760px, 120vw); height: auto;
    transform: translate(-50%, -64%);
    opacity: 0.07; pointer-events: none; user-select: none;
  }
  .glow {
    position: absolute; left: 50%; top: 42%;
    width: 460px; max-width: 94vw; height: 280px;
    transform: translate(-50%, -58%);
    border-radius: 9999px;
    background: rgba(255,176,32,0.14);
    filter: blur(120px);
  }
  .wrap { position: relative; z-index: 10; width: 100%; display: flex; justify-content: center; }
  .card {
    position: relative;
    width: min(430px, 100%);
    overflow: hidden;
    border-radius: 26px;
    border: 1px solid rgba(255,255,255,0.09);
    text-align: center;
    background: linear-gradient(168deg, rgba(255,255,255,0.075) 0%, rgba(255,255,255,0.042) 55%, rgba(255,255,255,0.058) 100%);
    box-shadow: 0 40px 120px -24px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.09);
    backdrop-filter: blur(24px);
  }
  .strip {
    position: absolute; top: 0; left: 0; right: 0; height: 3px;
    background: linear-gradient(90deg, transparent, rgba(255,176,32,0.9), transparent);
  }
  .inner { display: flex; flex-direction: column; align-items: center; padding: 28px 30px 26px; }
  .brand { display: flex; align-items: center; gap: 9px; }
  .brand svg { height: 19px; width: auto; }
  .brand span { font-size: 16.5px; font-weight: 650; letter-spacing: -0.03em; color: rgba(255,255,255,0.92); }
  .badge {
    margin-top: 24px;
    display: flex; align-items: center; justify-content: center;
    width: 68px; height: 68px; border-radius: 22px;
    background: rgba(255,176,32,0.12);
    box-shadow: inset 0 0 0 1px rgba(255,176,32,0.3);
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
  h1 { margin: 18px 0 0; font-size: 23px; font-weight: 800; line-height: 1.25; letter-spacing: -0.02em; }
  .body { margin: 10px auto 0; max-width: 350px; font-size: 14px; line-height: 1.65; color: rgba(255,255,255,0.62); }
  .reasons {
    margin: 16px 0 0; width: 100%; max-width: 330px;
    display: flex; flex-direction: column; gap: 6px;
    list-style: none; text-align: left;
  }
  .reasons li {
    display: flex; align-items: flex-start; gap: 8px;
    padding: 7px 12px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.07);
    background: rgba(255,255,255,0.06);
    font-size: 12.5px; line-height: 1.45; color: rgba(255,255,255,0.72);
  }
  .dot { margin-top: 5px; flex-shrink: 0; width: 6px; height: 6px; border-radius: 9999px; background: rgba(255,176,32,0.8); }
  .pill {
    margin-top: 16px;
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 13px; border-radius: 9999px;
    font-size: 12.5px; line-height: 1.4; color: #ffd58a;
    background: rgba(255,176,32,0.12);
    box-shadow: inset 0 0 0 1px rgba(255,176,32,0.3);
  }
  .note { margin: 10px auto 0; max-width: 330px; font-size: 11px; line-height: 1.5; color: rgba(255,255,255,0.4); }
  .rule { margin-top: 22px; width: 100%; height: 1px; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent); }
  .stamp { margin-top: 13px; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.24em; color: rgba(255,255,255,0.38); }
  @media (max-width: 480px) {
    body { padding: 16px; }
    .inner { padding: 24px 20px 22px; }
    .watermark { width: 150vw; }
  }
</style>
</head>
<body>
  <div class="backdrop" aria-hidden="true">
    <div class="glow"></div>
    <div class="watermark">${LOGO_SVG}</div>
  </div>
  <main class="wrap">
    <section class="card" role="alertdialog" aria-live="assertive" aria-label="${COPY.title}">
      <div class="strip" aria-hidden="true"></div>
      <div class="inner">
        <div class="brand">${LOGO_SVG}<span>Liner</span></div>
        <div class="badge">${HAMMER_SVG}</div>
        <h1>${COPY.title}</h1>
        <p class="body">${COPY.body}</p>
        ${reasonItems}
        <span class="pill">${CLOCK_SVG}${COPY.footer}</span>
        <p class="note">${COPY.retryNote}</p>
        <div class="rule" aria-hidden="true"></div>
        <span class="stamp">${COPY.stamp}</span>
      </div>
    </section>
  </main>
  <script>
    (function () {
      function check() {
        fetch("/api/maintenance", { cache: "no-store" })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) { if (d && d.enabled === false) location.reload(); })
          .catch(function () {});
      }
      setInterval(check, 30000);
    })();
  </script>
</body>
</html>
`;
}
