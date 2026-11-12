#!/bin/bash
# Fetch the live production DB mirror using the workspace key (never printed).
set -uo pipefail
PROJECT_DIR="${PROJECT_DIR:-/home/z/my-project}"
KEY="$(grep -E '^DB_MIRROR_EXPORT_KEY=' "$PROJECT_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d ' ')"
URL="${DB_MIRROR_SOURCE_URL:-https://liner-music.space-z.ai/api/db-mirror/latest}"
OUT="${1:-/tmp/prod-mirror.json}"

if [ -z "$KEY" ]; then
  echo "NO_KEY"
  exit 2
fi

RC=0
curl -fsS -m 30 -H "x-db-mirror-key: $KEY" -H "authorization: Bearer $KEY" "$URL" -o "$OUT" 2>/dev/null || RC=$?
if [ "$RC" != "0" ]; then
  # transport fallback: exportKey query param
  RC=0
  curl -fsS -m 30 "$URL?exportKey=$KEY" -o "$OUT" 2>/dev/null || RC=$?
fi
if [ "$RC" != "0" ]; then
  echo "FETCH_FAILED rc=$RC"
  exit 1
fi

python3 - "$OUT" << 'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
tables = data.get("tables") or {}
print("savedAt:", data.get("savedAt"))
total_accounts = 0
for name in sorted(tables):
    rows = tables[name] or []
    print(f"  {name}: {len(rows)}")
# usernames only (no emails) so the diagnosis is readable without leaking PII
accts = tables.get("account") or []
for a in accts:
    total_accounts += 1
    print(f"  account: username={a.get('username')} isGuest={a.get('isGuest')} created={a.get('createdAt')}")
mails = tables.get("emailLog") or []
for m in mails:
    print(f"  emailLog: type={m.get('type')} username={m.get('username')} status={m.get('status')}")
PYEOF
