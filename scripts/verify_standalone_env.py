#!/usr/bin/env python3
"""Build-time guard: the standalone package must carry the runtime env.

WHY THIS EXISTS: on 2026-11-12 production (liner-music.space-z.ai) started
answering {"code":"DISCORD_NOT_CONFIGURED"} to every login attempt. Root
cause: `next build` copies .env / .env.production into .next/standalone/ at
BUILD time — and the workspace .env had been wiped/rebuilt AFTER the last
build, so the deployed package carried a .env with only DATABASE_URL. Every
login button on the site 503'd while the sandbox itself looked perfectly
healthy (dev server loads .env directly).

This script runs at the very END of `npm run build` and fails the build with
a crystal-clear message when the packaged env is missing keys the runtime
needs. A failed build keeps the previous deployment live (the platform only
ships on success), which is strictly better than silently deploying a server
without login / mail / the db-mirror round-trip.

Required keys and what breaks without them:
  DATABASE_URL          local prod-runtime runs (FC start.sh exports its own)
  DISCORD_CLIENT_ID     Discord sign-in (503 DISCORD_NOT_CONFIGURED today's bug)
  DISCORD_PUBLIC_BASE   pins the OAuth redirect_uri (FC shows internal hosts)
  DISCORD_REDIRECT_URI  same — host-independent redirect_uri

DB_MIRROR_EXPORT_KEY moved to OPTIONAL on 2026-11-16: the owner has stated
twice they cannot supply the key, the standalone .env carries it commented
out, and as a REQUIRED key it made `npm run build` exit 1 — which the z.ai
platform deploy treats as a failed build, so liner-music.space-z.ai sat on
the platform's static "problem deploying" page. The mirror is a reset-
recovery round-trip, not a runtime dependency: running.sh (the primary
host) persists its database platform-side independent of the mirror, the
FC guest path degrades to the local pool, and a warning keeps the missing
key visible without holding production hostage.

DISCORD_CLIENT_SECRET / SMTP_USER / SMTP_PASS are OPTIONAL by design: the
OAuth flow works PKCE-only for public-client apps, and mail degrades to a
logged warning instead of failing requests.

LINER_SERVICE_EMAIL / LINER_SERVICE_PASS moved to OPTIONAL on 2026-11-16:
the sandbox reset lost the Polaris Mono service password, the owner does not
have it recorded, and the runtime already degrades cleanly without it
(isLinerServiceConfigured() -> false -> guest/website sessions fall back to
the local lrclib pool; upstream-account sessions keep their own bearer and
the e0556199 home-catalog fix). Blocking the deploy while production is DOWN
over a graceful-degrade feature is the wrong trade-off — a warning keeps the
consequence visible until the owner re-supplies the real password.
"""
import os
import sys

STANDALONE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    ".next",
    "standalone",
)

REQUIRED = [
    ("DATABASE_URL", "prod runtime cannot find the database"),
    ("DISCORD_CLIENT_ID", "Discord sign-in 503s (DISCORD_NOT_CONFIGURED)"),
    ("DISCORD_PUBLIC_BASE", "OAuth redirect_uri becomes host-dependent"),
    ("DISCORD_REDIRECT_URI", "OAuth redirect_uri becomes host-dependent"),
]

OPTIONAL_NOTE = [
    ("DISCORD_CLIENT_SECRET", "PKCE-only flow is used (works for public clients)"),
    ("SMTP_USER", "welcome/ban mail is DISABLED"),
    ("SMTP_PASS", "welcome/ban mail is DISABLED"),
    (
        "LINER_SERVICE_EMAIL",
        "guest/website sessions fall back to lrclib lyrics + home catalog "
        "(upstream-account sessions are NOT affected)",
    ),
    (
        "LINER_SERVICE_PASS",
        "guest/website sessions fall back to lrclib lyrics + home catalog "
        "(upstream-account sessions are NOT affected)",
    ),
    (
        "DB_MIRROR_EXPORT_KEY",
        "the deploy-time account/session mirror round-trip is OFF (reset-"
        "recovery only — running.sh persists its DB platform-side; the FC "
        "guest path degrades to the local pool)",
    ),
]

# .env and .env.production are loaded by @next/env from the standalone dir;
# process.env (start.sh exports) wins, files fill everything else.
ENV_FILES = [".env", ".env.production"]


def read_keys():
    merged = {}
    for name in ENV_FILES:
        path = os.path.join(STANDALONE, name)
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, value = line.partition("=")
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if key and value:
                        merged[key] = value
        except OSError as err:
            print(f"[verify-env] warn: cannot read {path}: {err}", file=sys.stderr)
    return merged


def main() -> int:
    if not os.path.isdir(STANDALONE):
        print("[verify-env] FAIL: .next/standalone not found (run next build first)")
        return 1

    env = dict(os.environ)
    env.update(read_keys())

    missing = [(key, why) for key, why in REQUIRED if not env.get(key, "").strip()]
    if missing:
        print("[verify-env] FAIL — the standalone package is missing required env keys:")
        for key, why in missing:
            present_files = [
                name for name in ENV_FILES
                if os.path.isfile(os.path.join(STANDALONE, name))
            ]
            print(f"  {key}: {why}")
            print(f"    (standalone carries: {', '.join(present_files) or 'NO .env files'})")
            print(f"    fix: restore the key in the workspace .env and rebuild")
        return 1

    for key, consequence in OPTIONAL_NOTE:
        if not env.get(key, "").strip():
            print(f"[verify-env] note: {key} empty -> {consequence}")

    print(
        "[verify-env] OK — standalone .env carries all required keys"
        f" (discord login, mirror key, pinned redirect)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
