#!/usr/bin/env python3
"""Inject the website CSP meta tag into the built SPA index.html.

The web build needs a strict CSP meta (same-origin default, YouTube embeds,
and the Turnstile verify page on *.tryliner.fun). The desktop release builds
share the same Vite template and must stay CSP-free — a restrictive meta
breaks Electron's file:// shell — so the policy is injected here, only on the
web deploy path (scripts/deploy.sh calls this right after `vite build`).

Idempotent: an already-present CSP meta is replaced in place.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' "
        "https://www.youtube.com https://s.ytimg.com",
        # 'self' lets the (legacy) same-origin relay verify iframe load
        "frame-src 'self' https://www.youtube.com "
        "https://www.youtube-nocookie.com https://*.tryliner.fun",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' * http: https: data: blob: liner-local:",
        "media-src 'self' * http: https: data: blob: liner-local:",
        "connect-src 'self' * http: https: ws: wss: data: blob:",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
    ]
)

META = (
    '<meta http-equiv="Content-Security-Policy" data-liner-csp '
    f'content="{CSP}">'
)


def main(path: str) -> int:
    file = Path(path)
    html = file.read_text(encoding="utf-8")
    if re.search(r'<meta[^>]*http-equiv="Content-Security-Policy"', html):
        html = re.sub(
            r'<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>',
            META,
            html,
            count=1,
        )
    else:
        html = html.replace("<head>", "<head>\n    " + META, 1)
    file.write_text(html, encoding="utf-8")
    print(f"CSP meta injected -> {file}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "dist/index.html"))
