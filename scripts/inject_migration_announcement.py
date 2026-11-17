#!/usr/bin/env python3
"""Inject the 'moving to running.sh' announcement into the Liner web SPA.

v3 (2026-11-17): the announcement lives in an EXTERNAL same-origin file,
liner-announcement.js, and index.html only gets a loader tag
<script src="/liner/liner-announcement.js"></script>. Why: the site's CSP is
`script-src 'self' 'unsafe-eval' ...` with NO 'unsafe-inline' (see
inject_web_csp.py), so the v1/v2 inline <script> blocks were silently
blocked by the browser — the modal never rendered. External 'self' scripts
pass the CSP untouched.

Idempotent: strips any older v1/v2/v3 injection first. The modal itself is
a self-contained IIFE (no deps): pill badge, long announcement body,
"Okay" (snoozes 24h) and "Don't show again" (localStorage, permanent).

Usage: python3 scripts/inject_migration_announcement.py [path/to/index.html]
Default: writes the JS file next to both SPA roots and injects the loader
tag into public/liner/index.html and liner-app/index.html.
"""
import re, sys, pathlib

MARKER = "liner-migration-announcement-v3"
OLD_MARKER_RE = r'<!-- INJECT:liner-migration-announcement-v\d+ -->\n<script id="liner-migration-announcement-v\d+">.*?</script>\n?'

# Loader tag injected into index.html (CSP-safe: same-origin external script)
LOADER_TAG = f"""<!-- INJECT:{MARKER} -->
<script src="/liner/liner-announcement.js" defer></script>
"""

JS_BODY = """/* Liner migration announcement v3 — see scripts/inject_migration_announcement.py */
(function () {
  try {
    var KEY = 'liner_migration_announcement_v3';
    var saved = localStorage.getItem(KEY);
    if (saved === 'never') return;
    if (saved && Number(saved) > Date.now()) return; // snoozed by "Okay"

    var css = document.createElement('style');
    css.textContent = [
      '#lm-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,17,21,.45);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}',
      '#lm-card{position:relative;width:100%;max-width:600px;max-height:min(86vh,720px);display:flex;flex-direction:column;background:#fff;border-radius:20px;box-shadow:0 24px 64px rgba(0,0,0,.28);overflow:hidden;}',
      '#lm-head{padding:22px 24px 0;text-align:center;flex:0 0 auto;}',
      '#lm-badge{display:inline-flex;align-items:center;gap:6px;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:999px;padding:6px 14px;font-size:13px;font-weight:600;color:#18181b;}',
      '#lm-x{position:absolute;top:14px;right:14px;width:30px;height:30px;border:none;border-radius:8px;background:transparent;color:#71717a;font-size:18px;cursor:pointer;line-height:1;}',
      '#lm-x:hover{background:#f4f4f5;color:#18181b;}',
      '#lm-body{flex:1 1 auto;overflow-y:auto;padding:8px 28px 4px;color:#3f3f46;font-size:14.5px;line-height:1.75;}',
      '#lm-body h2{color:#111113;font-size:21px;line-height:1.35;margin:14px 0 14px;text-align:left;}',
      '#lm-body p{margin:0 0 14px;}',
      '#lm-body b{color:#18181b;}',
      '#lm-foot{flex:0 0 auto;display:flex;justify-content:flex-end;gap:10px;padding:10px 24px 22px;}',
      '#lm-foot button{border-radius:10px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;}',
      '#lm-ok{background:#18181b;color:#fff;border:1px solid #18181b;}',
      '#lm-ok:hover{background:#2e2e33;}',
      '#lm-never{background:#fff;color:#52525b;border:1px solid #e4e4e7;}',
      '#lm-never:hover{background:#f4f4f5;color:#18181b;}',
      '@media (max-width:480px){#lm-body{padding:8px 20px 4px;}#lm-foot{flex-direction:column-reverse;}#lm-foot button{width:100%;}}'
    ].join('\\n');
    document.head.appendChild(css);

    var overlay = document.createElement('div');
    overlay.id = 'lm-overlay';
    overlay.innerHTML = [
      '<div id="lm-card" role="dialog" aria-modal="true" aria-label="Announcement">',
      '  <button id="lm-x" title="Close" aria-label="Close">\\u00d7</button>',
      '  <div id="lm-head"><span id="lm-badge">\\u2726 Announcement</span></div>',
      '  <div id="lm-body">',
      '    <h2>We\\u2019re switching to running.sh soon!</h2>',
      '    <p>Hey everyone \\u2014 first of all: <b>thank you</b>. From the very beginning, Liner has been built with you: every play, every command, every piece of feedback shaped what it is today. None of this would exist without the people who use it every day, and that genuinely means a lot to us.</p>',
      '    <p>For a long time, Liner and everything around it \\u2014 the web app, the music stack, the bots \\u2014 lived on <b>space-z.ai</b>. It was our first home, and it served us well while we grew. But lately it has been letting us (and you) down more and more: pages that take forever to load, services that sit inactive or unresponsive, random downtime, and infrastructure that simply hasn\\u2019t kept up with how much Liner is being used.</p>',
      '    <p>We\\u2019ve been quiet about it for a while because we wanted to fix things properly instead of just complaining. So we went looking for a new home \\u2014 and we found one: <b>running.sh</b>.</p>',
      '    <p>And honestly? It\\u2019s <b>way faster</b>. Page loads that used to crawl now snap open instantly. The bots reconnect quicker after hiccups. Playback starts sooner. Deployments that used to take ages now finish in a minute or two. It\\u2019s simply a faster, more reliable, more modern platform \\u2014 and it gives us <b>more and more</b> room to keep improving: always-on services, better logs and monitoring, quicker fixes when something breaks, and headroom for everything we want to build next.</p>',
      '    <p><b>So here\\u2019s the news: we\\u2019re moving to running.sh \\u2014 soon.</b> The web app you\\u2019re reading right now will live at the new address, and all the bots you know (Liner and Mr Alfredo) will run from the same new home.</p>',
      '    <p><b>The date is set: on January 2, 2027, space-z.ai will be discontinued.</b> From that day on, this website will <b>no longer receive any updates</b> \\u2014 no new features, no bug fixes, no maintenance, nothing. It will keep serving exactly as it is today, frozen, during the final stretch, and once everyone has safely moved over it will be retired for good. So please treat January 2, 2027 as the real deadline: update your bookmarks, update your server configs, and move over to running.sh before that day arrives.</p>',
      '    <p><b>What stays exactly the same:</b> your music, your playlists, your queues, your commands, your prefixes, your bots. Nothing about how you use Liner changes \\u2014 only where it runs. Everything gets faster as a side effect.</p>',
      '    <p><b>What\\u2019s new:</b> the web app\\u2019s new home is <b>liner-web-liner-bot-f3eq.running.sh</b>, with a proper custom domain (tryliner.jayjoice.com) on the way. Expect snappier responses, fewer \\u201cbot is thinking\\u201d moments, and quicker feature rollouts \\u2014 the stuff slow hosting never let us do.</p>',
      '    <p>This wasn\\u2019t a decision we made overnight, and we know migrations can be annoying. We\\u2019ll keep both homes running in parallel for a while, watch everything closely, and only cut over when the new home has proven itself. If anything looks off during the transition, tell us \\u2014 that\\u2019s exactly what this period is for.</p>',
      '    <p>Thanks for being here with us. The best part of Liner was never the servers \\u2014 it was you. We\\u2019ll keep putting care into every detail on the new home, so it stays something genuinely valuable to you. See you on running.sh! \\u2726</p>',
      '  </div>',
      '  <div id="lm-foot">',
      '    <button id="lm-never">Don\\u2019t show again</button>',
      '    <button id="lm-ok">Okay</button>',
      '  </div>',
      '</div>'
    ].join('\\n');
    document.body.appendChild(overlay);

    function close() { overlay.remove(); css.remove(); }
    document.getElementById('lm-ok').onclick = function () {
      try { localStorage.setItem(KEY, String(Date.now() + 24 * 60 * 60 * 1000)); } catch (e) {}
      close();
    };
    document.getElementById('lm-never').onclick = function () {
      try { localStorage.setItem(KEY, 'never'); } catch (e) {}
      close();
    };
    document.getElementById('lm-x').onclick = function () {
      try { localStorage.setItem(KEY, String(Date.now() + 24 * 60 * 60 * 1000)); } catch (e2) {}
      close();
    };
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        try { localStorage.setItem(KEY, String(Date.now() + 24 * 60 * 60 * 1000)); } catch (e3) {}
        close();
      }
    });
  } catch (e) { /* never break the app over an announcement */ }
})();
"""


def write_js() -> list:
    js_paths = [
        pathlib.Path("/home/z/my-project/public/liner/liner-announcement.js"),
        pathlib.Path("/home/z/my-project/liner-app/public/liner-announcement.js"),
    ]
    out = []
    for p in js_paths:
        p.write_text(JS_BODY, encoding="utf-8")
        out.append(f"js written: {p} ({p.stat().st_size} bytes)")
    return out


def inject(path: pathlib.Path) -> str:
    text = path.read_text(encoding="utf-8")
    text, n = re.subn(OLD_MARKER_RE, "", text, flags=re.S)  # strip any older version first
    if MARKER in text:
        return f"skip (already injected): {path}"
    if "</body>" not in text:
        return f"ERROR no </body> in {path}"
    text = text.replace("</body>", LOADER_TAG + "</body>", 1)
    path.write_text(text, encoding="utf-8")
    return f"injected (stripped {n} old block(s)): {path} ({path.stat().st_size} bytes)"


if __name__ == "__main__":
    for line in write_js():
        print(line)
    targets = [pathlib.Path(sys.argv[1])] if len(sys.argv) > 1 else [
        pathlib.Path("/home/z/my-project/public/liner/index.html"),
        pathlib.Path("/home/z/my-project/liner-app/index.html"),
    ]
    for t in targets:
        print(inject(t))
