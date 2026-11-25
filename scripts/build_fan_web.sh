#!/bin/bash
# Build the fan web app (the New UI — liner-app/src, the 0.2.12 redesign —
# with the original/material3 designs removed) and publish it as the ONLY
# UI at /liner:
#   liner-app (tsc -b && vite build, base /liner/)
#        -> liner-app/dist (CSP-injected)
#        -> public/liner   (what Next.js serves; /, /login, /library… rewrite here)
# 2026-11-25: the 0.2.20 beta renderer is retired from the site (it stays in
# git at liner-app/beta-renderer/); public/liner ships the fan build again.
set -euo pipefail

ROOT=/home/z/my-project
APP=$ROOT/liner-app
OUT=$ROOT/public/liner

cd "$APP"

# 0) deps (sandbox recycles wipe node_modules)
if [ ! -d node_modules/.bin ] || [ -z "$(ls node_modules/.bin 2>/dev/null | head -1)" ]; then
  echo "installing liner-app deps…"
  npm ci --no-audit --no-fund 2>&1 | tail -2
fi

# 1) build (tsc -b && vite build). VITE_API_URL stays unset — the SPA talks
#    to same-origin /v1 + /api only.
unset VITE_API_URL || true
npm run build

# 2) website CSP on the built shell (idempotent)
python3 "$ROOT/scripts/inject_web_csp.py" "$APP/dist/index.html"

# 3) publish: public/liner IS the fan build. Keep nothing from the beta
#    shell that was there before — the vite public/ dir already carries the
#    icons, previews, sw.js and cover-sw.js the app registers.
rm -rf "$OUT"
mkdir -p "$OUT"
cp -r "$APP/dist/." "$OUT/"

echo "public/liner now ships the fan New UI:"
grep -o 'assets/index-[^"]*\.js' "$OUT/index.html" | head -2
ls "$OUT" | head -12
