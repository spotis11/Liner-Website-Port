#!/bin/bash
# Extract the fan changelog data (liner-app/src/features/changelog/data/changelog.ts)
# into a plain JSON asset the beta shell's fan-features script can fetch:
#   liner-app/web-beta/changelog.json -> staged at /liner/fan/changelog.json
set -euo pipefail
ROOT=/home/z/my-project
OUT=$ROOT/liner-app/web-beta/changelog.json
cd "$ROOT/liner-app"
npx --yes esbuild src/features/changelog/data/changelog.ts \
  --bundle --format=cjs --platform=node --outfile=/tmp/changelog-data.cjs --log-level=silent
node -e '
const { CHANGELOG } = require("/tmp/changelog-data.cjs");
const fs = require("fs");
if (!Array.isArray(CHANGELOG) || CHANGELOG.length === 0) {
  console.error("changelog extraction produced nothing"); process.exit(1);
}
fs.writeFileSync(process.argv[1], JSON.stringify(CHANGELOG));
console.log("changelog.json:", CHANGELOG.length, "releases, newest",
  CHANGELOG[0].version, CHANGELOG[0].date);
' "$OUT"
