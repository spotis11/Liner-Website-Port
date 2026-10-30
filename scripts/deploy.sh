#!/usr/bin/env bash
# Rebuild liner-app SPA and deploy to Next.js prod (:3000)
set -euo pipefail
cd /home/z/my-project/liner-app

echo "=== 1. typecheck ==="
npx tsc -b

echo "=== 2. vite build ==="
npx vite build

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
nohup node .next/standalone/server.js > /tmp/liner-prod.log 2>&1 &
echo $! > /tmp/liner-prod.pid
sleep 3
curl -s -o /dev/null -w "prod :3000 -> HTTP %{http_code}\n" http://localhost:3000

echo "=== 7. bundle marker ==="
ls public/liner/assets/ | rg "^App-" | head -2
echo "DEPLOY DONE"
