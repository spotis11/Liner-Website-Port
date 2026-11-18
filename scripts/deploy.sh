#!/usr/bin/env bash
# Rebuild liner-app SPA and deploy to Next.js prod (:3000)
set -euo pipefail

# The website build must never inherit the Electron release CI's env vars.
# release.yml sets VITE_API_URL=https://api.tryliner.fun for the desktop
# builds; if that var leaks into this shell, `vite build` bakes the upstream
# API into the web bundle, resolveApiBaseUrl short-circuits past the
# same-origin branch, and every browser call cross-origins straight to
# api.tryliner.fun -> CORS failures for every visitor. The website always
# talks same-origin ("/v1/*"), so the var is simply unset here. Local dev
# overrides keep working via liner-app/.env files, which vite loads itself.
unset VITE_API_URL

cd /home/z/my-project/liner-app

echo "=== 1. typecheck ==="
npx tsc -b

echo "=== 2. vite build ==="
npx vite build

echo "=== 2.5 inject website CSP (desktop builds stay CSP-free) ==="
python3 /home/z/my-project/scripts/inject_web_csp.py dist/index.html

echo "=== 3. rsync dist -> public/liner ==="
rsync -a --delete dist/ /home/z/my-project/public/liner/
mkdir -p /home/z/my-project/.next/standalone/public/liner
rsync -a --delete dist/ /home/z/my-project/.next/standalone/public/liner/

cd /home/z/my-project
echo "=== 4. next build ==="
npm run build

echo "=== 5. fix standalone symlinks ==="
python3 scripts/fix_standalone_symlinks.py

echo "=== 6. restart prod :3000 ==="
if [ -f /tmp/liner-prod.pid ] && kill -0 "$(cat /tmp/liner-prod.pid)" 2>/dev/null; then
  kill "$(cat /tmp/liner-prod.pid)"; sleep 2
fi
# any other process still holding :3000 must go — the new boot dies with
# EADDRINUSE otherwise and a stale server keeps serving the old bundle.
# (no fuser on this box: parse the listener pid straight out of ss -ltnp)
for i in $(seq 1 15); do
  OWNER=$(ss -ltnp 2>/dev/null | grep ":3000 " | grep -oE "pid=[0-9]+" | head -1 | cut -d= -f2 || true)
  if [ -z "$OWNER" ]; then break; fi
  kill "$OWNER" 2>/dev/null || true
  sleep 1
done
nohup node .next/standalone/server.js > /tmp/liner-prod.log 2>&1 &
echo $! > /tmp/liner-prod.pid
sleep 3
curl -s -o /dev/null -w "prod :3000 -> HTTP %{http_code}\n" http://localhost:3000

echo "=== 7. bundle marker ==="
ls public/liner/assets/ | rg "^App-" | head -2
echo "DEPLOY DONE"
