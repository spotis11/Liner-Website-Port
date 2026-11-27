#!/usr/bin/env python3
"""Inject the permanent 'LINER HAS BEEN CLOSED' notice into the Liner web SPA.

v1 (2026-11-27, owner request): liner-music.space-z.ai must show a PERMANENT
full-screen closure notice — Liner logo, "LINER HAS BEEN CLOSED DUE TO
COPYRIGHT AND LEAKING, as stated in the official Liner README on GitHub" —
with NO close button and sign-in blocked behind it. Owner is explicit: the
notice must NOT point anyone to running.sh, and the whole update must NOT be
deployed to running.sh until they say so.

How both halves of that are guaranteed:
  1. Hostname gate inside liner-closed.js — it only mounts on
     *.space-z.ai (plus localhost/127.0.0.1 for local verification). The
     same shell served anywhere else stays silent.
  2. scripts/running_deploy_web.sh strips the loader tag and the JS file
     from its staging copy, so running.sh never even receives the file
     (same mechanism the migration announcement uses).

The notice's loader tag is injected BEFORE the migration-announcement tag:
defer scripts execute in document order, so liner-closed.js runs first and
sets the announcement's localStorage flag to 'never' — on the z.ai space the
"we're moving to running.sh" modal never appears while the closure is up.

Idempotent: strips any older liner-closed injection first. The JS source of
truth is public/liner/liner-closed.js; this script copies it next to both
SPA roots and injects the loader tag into public/liner/index.html and
liner-app/index.html.

Usage: python3 scripts/inject_closed_notice.py
"""
import re
import shutil
import sys
from pathlib import Path

ROOT = Path("/home/z/my-project")
SRC_JS = ROOT / "public/liner/liner-closed.js"

TARGETS = [
    ROOT / "public/liner/index.html",
    ROOT / "liner-app/index.html",
]

MARKER = "liner-closed-notice-v1"

# CSP-safe: same-origin external script, same pattern as the announcement
LOADER_TAG = (
    f"<!-- INJECT:{MARKER} -->\n"
    '<script src="/liner/liner-closed.js" defer></script>\n'
)

# idempotency: any older closure injection, whole lines
OLD_TAG_RE = re.compile(
    r"^<!-- INJECT:liner-closed-notice-v\d+ -->\n"
    r"^<script src=\"?/liner/liner-closed\.js\"?[^>]*></script>\n?",
    re.M,
)


def strip_old(html: str) -> str:
    html = OLD_TAG_RE.sub("", html)
    # line-based fallback for hand-edited variants
    lines = [
        ln
        for ln in html.splitlines(keepends=True)
        if "INJECT:liner-closed-notice-v" not in ln
        and "/liner/liner-closed.js" not in ln
    ]
    return "".join(lines)


def inject(html: str) -> str:
    html = strip_old(html)
    # before the migration-announcement loader tag if present, else before
    # </body> — defer order then guarantees closure-first execution
    ann = html.find("<!-- INJECT:liner-migration-announcement-")
    if ann != -1:
        return html[:ann] + LOADER_TAG + html[ann:]
    close = html.rfind("</body>")
    if close == -1:
        raise SystemExit(f"no </body> and no announcement tag — inject manually")
    return html[:close] + LOADER_TAG + html[close:]


def main() -> None:
    if not SRC_JS.is_file():
        raise SystemExit(f"missing source {SRC_JS}")

    changed = 0
    for target in TARGETS:
        if not target.is_file():
            print(f"skip (missing): {target}")
            continue
        html = target.read_text(encoding="utf-8")
        out = inject(html)
        if out != html:
            target.write_text(out, encoding="utf-8")
            changed += 1
            print(f"injected: {target}")
        else:
            print(f"already present: {target}")

    # keep a copy of the JS next to the liner-app SPA root so a rebuild of
    # that tree finds it (the served copy is public/liner/liner-closed.js)
    sibling = ROOT / "liner-app/liner-closed.js"
    if not sibling.is_file() or sibling.read_text(encoding="utf-8") != SRC_JS.read_text(encoding="utf-8"):
        shutil.copyfile(SRC_JS, sibling)
        print(f"copied JS -> {sibling}")

    if changed == 0:
        print("nothing changed")
    sys.exit(0)


if __name__ == "__main__":
    main()
