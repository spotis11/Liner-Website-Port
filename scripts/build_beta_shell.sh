#!/bin/bash
# Assemble the Liner 0.2.20 beta web shell (shipped at /liner-beta/):
#   liner-app/beta-renderer/  (committed: minified 0.2.20 renderer from the
#                              AppImage + shim.js + patched index.html)
#        -> liner-app/dist    (deployable shell: CSP-injected)
# 2026-11-24 (later): the v1.34.3 fan build is BACK as the default UI at
# /liner (public/liner, restored from ef1b513b) — the beta renderer moves to
# /liner-beta so both UIs ship. The shim gets a content-hashed filename:
# every build is a new URL, immune to browser caching. potworker.html is the
# shim-only page the hidden mint worker iframe loads.
set -euo pipefail

ROOT=/home/z/my-project
BETA=$ROOT/liner-app/beta-renderer
DIST=$ROOT/liner-app/dist
OUT=$ROOT/liner-app/web-beta
BETA_BASE=/liner-beta

# 1) bundle the shim (esbuild, IIFE, loads as a classic script before the app module)
cd "$ROOT/liner-app"
# esbuild may be missing in a recycled sandbox — fall back to the committed
# web-beta/shim.js (shim.ts is unchanged since that commit, same artifact)
if ! npx --yes esbuild web-beta/shim.ts --bundle --format=iife --target=es2022 --minify --outfile="$OUT/shim.js" 2>/tmp/esbuild-fallback.log; then
  echo "esbuild unavailable — using committed web-beta/shim.js"
  [ -s "$OUT/shim.js" ] || { echo "FATAL: no esbuild and no committed shim.js" >&2; exit 1; }
fi
SHIM_HASH=$(python3 -c "import hashlib;print(hashlib.sha1(open('$OUT/shim.js','rb').read()).hexdigest()[:10])")
SHIM_NAME="shim-$SHIM_HASH.js"
echo "shim: $(wc -c < "$OUT/shim.js") bytes -> $SHIM_NAME"

# 2) stage the renderer
rm -rf "$DIST"
mkdir -p "$DIST"
cp -r "$BETA/dist/assets" "$DIST/assets"
cp "$OUT/shim.js" "$DIST/$SHIM_NAME"

# 3) index.html: shim first (classic script), then the app module
python3 - "$SHIM_NAME" "$BETA_BASE" <<'PYEOF'
import re, sys
shim_name = sys.argv[1]
base = sys.argv[2]
src = open("/home/z/my-project/liner-app/beta-renderer/dist/index.html").read()
# the shell is served at /liner-beta (and any document URL): absolute
# $base URLs + a <base> work at EVERY document URL; the window-controls
# style hides the desktop titlebar capsule (web has no window)
src = re.sub(r'(src|href)="\.?/', r'\1="' + base + r'/', src)
assert "<head>" in src
out = src.replace(
    "<head>",
    '<head>\n    <base href="' + base + '/">\n'
    '    <style>[data-window-controls],.window-controls-pill{display:none!important}</style>',
    1,
)
shim = f'    <script src="{base}/{shim_name}"></script>\n'
assert "<script" in out
out = out.replace("    <script", shim + "    <script", 1)
open("/home/z/my-project/liner-app/dist/index.html", "w").write(out)
print(f"index.html: absolute {base}/ refs + base injected, shim ->", shim_name)
for m in re.findall(r'(?:src|href)="[^"]+"', out)[:8]:
    print("  ", m)
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
    <script src="$BETA_BASE/$SHIM_NAME"></script>
  </head>
  <body></body>
</html>
HTMLEOF

# 4) website CSP (inject_web_csp.py operates on dist/index.html)
python3 "$ROOT/scripts/inject_web_csp.py" "$DIST/index.html"

# 5) ship the beta shell at public/liner-beta (public/liner is the fan build)
rm -rf "$ROOT/public/liner-beta"
cp -r "$DIST" "$ROOT/public/liner-beta"

echo "beta shell assembled: $(du -sh "$DIST" | cut -f1) -> public/liner-beta"
ls "$DIST" | head -5
