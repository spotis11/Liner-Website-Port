#!/bin/bash
# Assemble the Liner 0.2.20 beta web shell:
#   liner-app/beta-renderer/  (committed: minified 0.2.20 renderer from the
#                              AppImage + shim.js + patched index.html)
#        -> liner-app/dist    (deployable shell: CSP-injected)
# The 0.2.12 vite build is retired — the beta renderer IS the app UI.
set -euo pipefail

ROOT=/home/z/my-project
BETA=$ROOT/liner-app/beta-renderer
DIST=$ROOT/liner-app/dist
OUT=$ROOT/liner-app/web-beta

# 1) bundle the shim (esbuild, IIFE, loads as a classic script before the app module)
cd "$ROOT/liner-app"
npx esbuild web-beta/shim.ts --bundle --format=iife --target=es2022 --minify --outfile="$OUT/shim.js"
echo "shim: $(wc -c < "$OUT/shim.js") bytes"

# 2) stage the renderer
rm -rf "$DIST"
mkdir -p "$DIST"
cp -r "$BETA/dist/assets" "$DIST/assets"
cp "$OUT/shim.js" "$DIST/shim.js"

# 3) index.html: shim first (classic script), then the app module (already
#    present); rewrite ./assets -> assets/ (cosmetic) and inject the fan meta
python3 - <<'PYEOF'
import re
src = open("/home/z/my-project/liner-app/beta-renderer/dist/index.html").read()
# shim must run before the app module: inject right after <head> opens
shim = '    <script src="./shim.js"></script>\n'
assert "<script" in src
out = src.replace("    <script", shim + "    <script", 1)
open("/home/z/my-project/liner-app/dist/index.html", "w").write(out)
print("index.html: shim injected")
PYEOF

# 4) website CSP (inject_web_csp.py operates on dist/index.html)
python3 "$ROOT/scripts/inject_web_csp.py" "$DIST/index.html"

echo "beta shell assembled: $(du -sh "$DIST" | cut -f1)"
ls "$DIST"
