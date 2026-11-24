#!/bin/bash
# Assemble the Liner 0.2.20 beta web shell:
#   liner-app/beta-renderer/  (committed: minified 0.2.20 renderer from the
#                              AppImage + shim.js + patched index.html)
#        -> liner-app/dist    (deployable shell: CSP-injected)
# The 0.2.12 vite build is retired — the beta renderer IS the app UI.
# The shim gets a content-hashed filename: every build is a new URL, immune
# to browser caching. potworker.html is the shim-only page the hidden mint
# worker iframe loads.
set -euo pipefail

ROOT=/home/z/my-project
BETA=$ROOT/liner-app/beta-renderer
DIST=$ROOT/liner-app/dist
OUT=$ROOT/liner-app/web-beta

# 1) bundle the shim (esbuild, IIFE, loads as a classic script before the app module)
cd "$ROOT/liner-app"
npx esbuild web-beta/shim.ts --bundle --format=iife --target=es2022 --minify --outfile="$OUT/shim.js"
SHIM_HASH=$(python3 -c "import hashlib;print(hashlib.sha1(open('$OUT/shim.js','rb').read()).hexdigest()[:10])")
SHIM_NAME="shim-$SHIM_HASH.js"
echo "shim: $(wc -c < "$OUT/shim.js") bytes -> $SHIM_NAME"

# 2) stage the renderer
rm -rf "$DIST"
mkdir -p "$DIST"
cp -r "$BETA/dist/assets" "$DIST/assets"
cp "$OUT/shim.js" "$DIST/$SHIM_NAME"

# 3) index.html: shim first (classic script), then the app module
python3 - "$SHIM_NAME" <<'PYEOF'
import sys
shim_name = sys.argv[1]
src = open("/home/z/my-project/liner-app/beta-renderer/dist/index.html").read()
shim = f'    <script src="./{shim_name}"></script>\n'
assert "<script" in src
out = src.replace("    <script", shim + "    <script", 1)
open("/home/z/my-project/liner-app/dist/index.html", "w").write(out)
print("index.html: shim injected ->", shim_name)
PYEOF

# 3.5) potworker.html: a shim-only page — the hidden mint-worker iframe
# loads this instead of the app (no module script at all)
cat > "$DIST/potworker.html" <<HTMLEOF
<!doctype html>
<html lang="en" class="antialiased">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>potworker</title>
    <script src="./$SHIM_NAME"></script>
  </head>
  <body></body>
</html>
HTMLEOF

# 4) website CSP (inject_web_csp.py operates on dist/index.html)
python3 "$ROOT/scripts/inject_web_csp.py" "$DIST/index.html"

echo "beta shell assembled: $(du -sh "$DIST" | cut -f1)"
ls "$DIST" | head -5
