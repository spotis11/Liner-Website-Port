#!/bin/bash
# Assemble the Liner 0.2.20 beta web shell — THE ONLY UI, shipped at /liner
# (and served at /, /login, /library … via next.config.ts rewrites):
#
#   liner-app/beta-renderer/  (committed: minified 0.2.20 renderer from the
#                              AppImage + patched index.html)
#   liner-app/web-beta/       (shim.ts + fan-features.ts — everything a
#                              browser lacks + the four fan features)
#   liner-app/web-beta/changelog.json  (fan changelog data)
#        -> liner-app/dist    (deployable shell: CSP-injected)
#        -> public/liner      (what Next.js serves)
#
# 2026-11-25: the beta moves BACK to /liner as the only UI (the owner
# rejected the dual-ship with the old fan build as default). The shim gains
# the four fan features: changelog, AI translate, Discord RPC (direct
# gateway), lyric style themes. Both scripts get content-hashed filenames —
# every build is a new URL, immune to browser caching. potworker.html is the
# shim-only page the hidden mint worker iframe loads.
set -euo pipefail

ROOT=/home/z/my-project
BETA=$ROOT/liner-app/beta-renderer
DIST=$ROOT/liner-app/dist
OUT=$ROOT/liner-app/web-beta
BETA_BASE=/liner

cd "$ROOT/liner-app"

# 1) bundle the shim + the fan feature layer (esbuild, IIFE classic scripts)
if ! npx --yes esbuild web-beta/shim.ts --bundle --format=iife --target=es2022 --minify --outfile="$OUT/shim.js" 2>/tmp/esbuild-fallback.log; then
  echo "esbuild unavailable — using committed web-beta/shim.js" >&2
  [ -s "$OUT/shim.js" ] || { echo "FATAL: no esbuild and no committed shim.js" >&2; exit 1; }
fi
if ! npx --yes esbuild web-beta/fan-features.ts --bundle --format=iife --target=es2022 --minify --outfile="$OUT/fan-features.js" 2>>/tmp/esbuild-fallback.log; then
  echo "FATAL: fan-features bundle failed and there is no fallback" >&2
  exit 1
fi
hash_name() { # file prefix -> "<prefix>-<sha1[:10]>.js"
  python3 -c "import hashlib,sys;print(sys.argv[1]+'-'+hashlib.sha1(open(sys.argv[2],'rb').read()).hexdigest()[:10]+'.js')" "$1" "$2"
}
SHIM_NAME=$(hash_name shim "$OUT/shim.js")
FAN_NAME=$(hash_name fan-features "$OUT/fan-features.js")
echo "shim: $(wc -c < "$OUT/shim.js") bytes -> $SHIM_NAME"
echo "fan-features: $(wc -c < "$OUT/fan-features.js") bytes -> $FAN_NAME"

# 2) stage the renderer
rm -rf "$DIST"
mkdir -p "$DIST/fan"
cp -r "$BETA/dist/assets" "$DIST/assets"
cp "$OUT/shim.js" "$DIST/$SHIM_NAME"
cp "$OUT/fan-features.js" "$DIST/$FAN_NAME"
cp "$OUT/changelog.json" "$DIST/fan/changelog.json"

# 3) index.html: shim first (classic script), the app module, then the fan
#    layer (classic script, after the module so it finds the booted app).
#    Absolute $base URLs + <base> make the shell work at EVERY document URL;
#    the window-controls style hides the desktop titlebar capsule (web has
#    no window — the owner explicitly asked the ✕ gone from the fullscreen
#    player).
python3 - "$SHIM_NAME" "$FAN_NAME" "$BETA_BASE" <<'PYEOF'
import re, sys
shim_name, fan_name, base = sys.argv[1], sys.argv[2], sys.argv[3]
src = open("/home/z/my-project/liner-app/beta-renderer/dist/index.html").read()
src = re.sub(r'(src|href)="\.?/', r'\1="' + base + r'/', src)
assert "<head>" in src
out = src.replace(
    "<head>",
    '<head>\n    <base href="' + base + '/">\n'
    '    <style>[data-window-controls],.window-controls-pill{display:none!important}</style>',
    1,
)
shim = f'    <script src="{base}/{shim_name}"></script>\n'
fan = f'    <script defer src="{base}/{fan_name}"></script>\n'
assert "<script" in out
out = out.replace("    <script", shim + "    <script", 1)
# append the fan layer after the app module script tag
parts = out.rsplit("</script>", 1)
assert len(parts) == 2, "unexpected index.html shape"
out = parts[0] + "</script>\n" + fan + "</script>" + parts[1]
open("/home/z/my-project/liner-app/dist/index.html", "w").write(out)
print(f"index.html: absolute {base}/ refs + base + controls CSS, shim -> {shim_name}, fan -> {fan_name}")
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

# 5) publish: public/liner IS the beta shell now. Keep the icon set the
#    manifest/apple-touch links reference (generic Liner icons from the fan
#    build) — everything else (the old fan SPA chunks) is retired.
mkdir -p "$ROOT/public/liner"
for icon in icon.png icon-192.png icon-512.png icon-maskable-192.png icon-maskable-512.png; do
  if [ -f "$ROOT/public/liner/$icon" ]; then
    cp "$ROOT/public/liner/$icon" "/tmp/liner-icon-$icon"
  fi
done
rm -rf "$ROOT/public/liner"
mkdir -p "$ROOT/public/liner"
cp -r "$DIST/assets" "$ROOT/public/liner/assets"
cp "$DIST/index.html" "$DIST/potworker.html" "$ROOT/public/liner/"
# the beta registers cover-sw.js at scope "/" — ship it (headers() allows it)
cp "$BETA/dist/cover-sw.js" "$ROOT/public/liner/cover-sw.js"
cp "$DIST/$SHIM_NAME" "$DIST/$FAN_NAME" "$ROOT/public/liner/"
cp -r "$DIST/fan" "$ROOT/public/liner/fan"
for icon in icon.png icon-192.png icon-512.png icon-maskable-192.png icon-maskable-512.png; do
  if [ -f "/tmp/liner-icon-$icon" ]; then cp "/tmp/liner-icon-$icon" "$ROOT/public/liner/$icon"; fi
done

echo "public/liner now ships the 0.2.20 beta shell (shim $SHIM_NAME, fan $FAN_NAME)"
